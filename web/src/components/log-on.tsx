import { SignInButton } from "@clerk/nextjs";

import { PixelIcon } from "./pixel-icon";
import { Button } from "./xp";

interface LogOnProps {
  /** Shown as "Log On to <app>". */
  app: string;
  message: string;
}

export function LogOn({ app, message }: LogOnProps) {
  return (
    <div className="flex min-h-72 items-center justify-center bg-white p-6">
      <div className="xp-dialog" role="dialog" aria-labelledby="logon-title">
        <div className="xp-titlebar" style={{ height: 26 }}>
          <PixelIcon name="user" size={16} />
          <span className="title" id="logon-title">
            Log On to {app}
          </span>
        </div>
        <div className="xp-dialog-body flex items-start gap-4">
          <PixelIcon name="user" size={32} />
          <p className="pt-1">{message}</p>
        </div>
        <div className="xp-dialog-actions">
          <SignInButton mode="redirect">
            <Button className="default">Sign in...</Button>
          </SignInButton>
        </div>
      </div>
    </div>
  );
}
