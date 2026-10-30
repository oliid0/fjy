import { useRef, useState } from "react";
import ButtonBase from "@mui/material/ButtonBase";
import { t } from "@fcboard/fcboard/i18n";

import { classroomCommands } from "./commands";
import rowAdd from "./factory-table-icons/row-add.svg";
import rowRemove from "./factory-table-icons/row-remove.svg";
import columnAdd from "./factory-table-icons/column-add.svg";
import columnRemove from "./factory-table-icons/column-remove.svg";

import type { InsertObject } from "./insertObjects";

/** SelectCacheLayer's four end-track actions, after copy and delete. */
export const TableActions = ({
  table,
  disabled,
  onError,
}: {
  table: InsertObject;
  disabled: boolean;
  onError: (message: string) => void;
}) => {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      {(
        [
          ["row.add", "add_row", rowAdd],
          ["row.remove", "remove_row", rowRemove],
          ["column.add", "add_column", columnAdd],
          ["column.remove", "remove_column", columnRemove],
        ] as const
      ).map(([action, label, icon]) => (
        <ButtonBase
          key={action}
          aria-label={t(`fcboard.${label}`)}
          title={t(`fcboard.${label}`)}
          disabled={disabled || busy}
          onClick={async () => {
            if (pending.current) {
              return;
            }
            pending.current = true;
            setBusy(true);
            onError("");
            try {
              await classroomCommands.execute({
                name: "table.track",
                args: { id: table.id, action },
              });
            } catch (failure) {
              onError(
                failure instanceof Error ? failure.message : String(failure),
              );
            } finally {
              pending.current = false;
              setBusy(false);
            }
          }}
        >
          <img src={icon} alt="" draggable={false} />
        </ButtonBase>
      ))}
    </>
  );
};
