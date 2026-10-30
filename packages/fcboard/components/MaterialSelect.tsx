import { Children, isValidElement, useState } from "react";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";

import type { CSSProperties, ReactNode, ReactElement } from "react";
import type { SelectChangeEvent } from "@mui/material/Select";

type ChoiceProps = {
  value: string | number;
  disabled?: boolean;
  children: ReactNode;
};

/** Controlled, flat choices share the same dismissible menu in a panel or dialog. */
export const MaterialSelect = ({
  value,
  children,
  onChange,
  disabled,
  className = "",
  style,
  "aria-label": label,
}: {
  value: string | number;
  children: ReactNode;
  onChange: (event: SelectChangeEvent<string>) => void;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  "aria-label": string;
}) => {
  const [open, setOpen] = useState(false);
  const choices = Children.toArray(children).filter(
    (child): child is ReactElement<ChoiceProps> =>
      isValidElement<ChoiceProps>(child),
  );
  // Recording IDs and document pages can arrive before their asynchronous list.
  const selected = choices.some(
    (choice) => String(choice.props.value) === String(value),
  )
    ? String(value)
    : "";
  return (
    <Select<string>
      fullWidth
      size="small"
      displayEmpty
      className={`fc-material-select ${className}`}
      style={style}
      value={selected}
      disabled={disabled}
      inputProps={{ inputMode: "none" }}
      inputRef={(handle: { node?: HTMLInputElement } | null) => {
        // SelectInput discards its type prop. Its value input must not become
        // the enclosing label's editable target on Android.
        if (handle?.node) {
          handle.node.type = "hidden";
          handle.node.readOnly = true;
        }
      }}
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      onChange={onChange}
      SelectDisplayProps={{ "aria-label": label }}
      onKeyDown={(event) => {
        if (open) {
          event.stopPropagation();
        }
      }}
      onPointerDown={(event) => event.stopPropagation()}
      MenuProps={{
        disablePortal: true,
        slotProps: {
          paper: {
            sx: {
              maxHeight: "min(320px, calc(100dvh - 32px))",
              color: "var(--fc-ink, #17243c)",
              backgroundColor: "var(--fc-surface, #fff)",
              border: "1px solid var(--fc-border, #dce3ec)",
              borderRadius: "6px",
              fontFamily: "inherit",
              "& .MuiMenuItem-root": {
                minHeight: 36,
                fontSize: 14,
                whiteSpace: "normal",
                overflowWrap: "anywhere",
              },
              "& .Mui-selected, & .Mui-selected:hover": {
                color: "#fff",
                backgroundColor: "var(--fc-blue, #0b6ff3)",
              },
            },
          },
        },
      }}
      sx={{
        minWidth: 0,
        minHeight: 36,
        fontFamily: "inherit",
        fontSize: "inherit",
        color: "inherit",
        borderRadius: "6px",
        "& .MuiSelect-select": { padding: "7px 32px 7px 10px" },
        "& .MuiOutlinedInput-notchedOutline": {
          borderColor: "var(--fc-border, #dce3ec)",
        },
      }}
    >
      {choices.map((child) => (
        <MenuItem
          key={String(child.props.value)}
          value={String(child.props.value)}
          disabled={child.props.disabled}
        >
          {child.props.children}
        </MenuItem>
      ))}
    </Select>
  );
};
