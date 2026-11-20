(() => {
  const status = document.getElementById("status");
  const start = document.getElementById("cast");
  const stop = document.getElementById("stop");
  const strings = JSON.parse(document.getElementById("messages").textContent);

  if (
    !navigator.mediaDevices?.getDisplayMedia ||
    typeof RTCPeerConnection === "undefined"
  ) {
    status.textContent = strings.unsupported;
    start.disabled = true;
    return;
  }
  start.disabled = false;

  let active;
  function end(message) {
    const session = active;
    active = undefined;
    if (session) {
      clearTimeout(session.timeout);
      clearTimeout(session.retry);
      clearInterval(session.heartbeat);
      session.socket?.close();
      session.peer?.close();
      session.stream?.getTracks().forEach((track) => track.stop());
    }
    status.textContent = message;
    start.disabled = false;
    stop.hidden = true;
  }

  function gather(peer) {
    if (peer.iceGatheringState === "complete") {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        peer.removeEventListener("icegatheringstatechange", check);
        resolve();
      };
      const check = () => {
        if (peer.iceGatheringState === "complete") {
          done();
        }
      };
      const timer = setTimeout(done, 4000);
      peer.addEventListener("icegatheringstatechange", check);
    });
  }

  start.addEventListener("click", async () => {
    if (active) {
      return;
    }
    const session = {};
    active = session;
    start.disabled = true;
    status.textContent = strings.connecting;
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { resizeMode: "none", frameRate: { ideal: 60 } },
        audio: true,
      });
      if (active !== session) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      session.stream = stream;
      stop.hidden = false;
      stream.getVideoTracks()[0].addEventListener("ended", () => {
        if (active === session) {
          end(strings.ended);
        }
      });
      const peer = new RTCPeerConnection({ iceServers: [] });
      session.peer = peer;
      for (const track of stream.getTracks()) {
        const sender = peer.addTrack(track, stream);
        if (track.kind !== "video") {
          continue;
        }
        if ("contentHint" in track) {
          track.contentHint = "detail";
        }
        const parameters = sender.getParameters();
        parameters.degradationPreference = "maintain-resolution";
        await sender.setParameters(parameters).catch(() => {});
      }
      const address = new URL("signal", location.href);
      address.protocol = "wss:";
      const socket = new WebSocket(address);
      session.socket = socket;
      session.timeout = setTimeout(() => {
        if (active === session) {
          end(strings.failed);
        }
      }, 20000);
      socket.addEventListener("close", () => {
        if (active === session) {
          end(
            peer.connectionState === "connected"
              ? strings.ended
              : strings.failed,
          );
        }
      });
      const sendOffer = async (restart) => {
        const offer = await peer.createOffer({ iceRestart: restart });
        await peer.setLocalDescription(offer);
        await gather(peer);
        if (active === session) {
          socket.send(
            JSON.stringify({
              kind: restart ? "restart" : "offer",
              sdp: peer.localDescription.sdp,
            }),
          );
        }
      };
      peer.addEventListener("connectionstatechange", () => {
        if (active !== session) {
          return;
        }
        if (peer.connectionState === "connected") {
          clearTimeout(session.timeout);
          clearTimeout(session.retry);
          session.retry = undefined;
          status.textContent = strings.sharing;
        } else if (
          ["disconnected", "failed"].includes(peer.connectionState) &&
          !session.retry
        ) {
          status.textContent = strings.connecting;
          clearTimeout(session.timeout);
          session.timeout = setTimeout(() => {
            if (active === session) {
              end(strings.failed);
            }
          }, 20000);
          session.retry = setTimeout(
            () => {
              if (
                active !== session ||
                socket.readyState !== WebSocket.OPEN ||
                peer.signalingState !== "stable"
              ) {
                return;
              }
              void sendOffer(true).catch(() => {
                if (active === session) {
                  end(strings.failed);
                }
              });
            },
            peer.connectionState === "failed" ? 0 : 2500,
          );
        }
      });
      socket.addEventListener("message", async ({ data }) => {
        if (active !== session) {
          return;
        }
        try {
          const signal = JSON.parse(data);
          if (signal.kind === "answer" && typeof signal.sdp === "string") {
            await peer.setRemoteDescription({
              type: "answer",
              sdp: signal.sdp,
            });
          }
        } catch {
          if (active === session) {
            end(strings.failed);
          }
        }
      });
      await new Promise((resolve, reject) => {
        socket.addEventListener("open", resolve, { once: true });
        socket.addEventListener("error", reject, { once: true });
        socket.addEventListener("close", reject, { once: true });
      });
      await sendOffer(false);
      if (active === session) {
        session.heartbeat = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send("ping");
          }
        }, 20000);
      }
    } catch (error) {
      if (active === session) {
        end(error?.name === "NotAllowedError" ? strings.ended : strings.failed);
      }
    }
  });
  stop.addEventListener("click", () => end(strings.ended));
  window.addEventListener("pagehide", () => end(strings.ended));
})();
