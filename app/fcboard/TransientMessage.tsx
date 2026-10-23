import { useEffect, useState } from "react";

/** Hide feedback without clearing functional state (e.g. a failed document stays failed). */
export const TransientMessage = ({
  message,
  role = "status",
  className,
  duration = 4500,
}: {
  message: string;
  role?: "alert" | "status";
  className?: string;
  duration?: number;
}) => {
  const [visible, setVisible] = useState(message);
  useEffect(() => {
    setVisible(message);
    const timer = setTimeout(() => setVisible(""), duration);
    return () => clearTimeout(timer);
  }, [message, duration]);
  return visible && message ? (
    <div className={className} role={role}>
      {visible}
    </div>
  ) : null;
};
