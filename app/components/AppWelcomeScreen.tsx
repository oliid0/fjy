import { WelcomeScreen } from "@excalidraw/excalidraw";
import { useI18n } from "@excalidraw/excalidraw/i18n";
import React from "react";

export const AppWelcomeScreen = React.memo(
  (_props: { onCollabDialogOpen: () => void; isCollabEnabled: boolean }) => {
    const { t } = useI18n();
    return (
      <WelcomeScreen>
        <WelcomeScreen.Center>
          <WelcomeScreen.Center.Logo />
          <WelcomeScreen.Center.Heading>
            · Fcboard
            <br />
            {t("fcboard.make_every_explanation_clear")}
          </WelcomeScreen.Center.Heading>
          <WelcomeScreen.Center.Menu>
            <WelcomeScreen.Center.MenuItemLoadScene />
          </WelcomeScreen.Center.Menu>
        </WelcomeScreen.Center>
      </WelcomeScreen>
    );
  },
);
