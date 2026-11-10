import { AnimatedTrail } from "../animated-trail";

import type { AnimationFrameHandler } from "../animation-frame-handler";
import type App from "../components/App";

/** SelectorLine + res/color/eraser_color (#30ff0000). */
export class FactoryCircleTrail extends AnimatedTrail {
  constructor(handler: AnimationFrameHandler, app: App) {
    super(handler, app, {
      factoryCircle: true,
      fill: () => "#ff000030",
      stroke: () => "#ff0000",
    });
  }

  endPath() {
    this.clearTrails();
    this.stop();
  }
}
