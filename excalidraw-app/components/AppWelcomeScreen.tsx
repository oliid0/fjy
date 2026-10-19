import { WelcomeScreen } from "@excalidraw/excalidraw";
import React from "react";

export const AppWelcomeScreen = React.memo(
  (_props: { onCollabDialogOpen: () => void; isCollabEnabled: boolean }) => (
    <WelcomeScreen>
      <WelcomeScreen.Center>
        <WelcomeScreen.Center.Logo />
        <WelcomeScreen.Center.Heading>
          · Fcboard
          <br />
          让每一次讲解清晰可见
        </WelcomeScreen.Center.Heading>
        <WelcomeScreen.Center.Menu>
          <WelcomeScreen.Center.MenuItemLoadScene />
        </WelcomeScreen.Center.Menu>
      </WelcomeScreen.Center>
    </WelcomeScreen>
  ),
);
