import { createStore, get, set } from "idb-keyval";

const playlists = createStore("fcboard-media", "playlists");
export const saveMediaFiles = (key: string, files: File[]) =>
  set(key, files, playlists);
export const readMediaFiles = (key: string) => get<File[]>(key, playlists);

// Only the newly inserted object starts playback. Copies and restored pages open paused.
export const pendingMediaPlayback = new Set<string>();
