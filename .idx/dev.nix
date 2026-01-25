{ pkgs }: {
  channel = "stable-24.05";

  packages = [
    pkgs.nodejs_latest
  ];

  idx.extensions = [
    "dbaeumer.vscode-eslint"
    "esbenp.prettier-vscode"
    "ms-vscode.vscode-typescript-next"
    "bradlc.vscode-tailwindcss"
  ];

  idx.previews = {
    previews = {
      client = {
        command = [ "npm" "run" "dev:client" ];
        manager = "web";
      };
      server = {
        command = [ "npm" "run" "dev:server" ];
        manager = "process";
      };
    };
  };
}