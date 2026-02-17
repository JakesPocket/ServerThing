{ pkgs, ... }:
let
  # This file is copied into nixos-superbird/examples/clientthing.nix during CI.
  # Assets are staged into examples/clientthing-assets/ by the workflow.
  assets = ./clientthing-assets;

  clientthingWebapp = pkgs.runCommand "clientthing-webapp" { } ''
    mkdir -p "$out"
    cp ${assets}/shell-bootstrap.html "$out/index.html"
  '';

  clientthingBridgeJs = pkgs.writeText "clientthing-input-bridge.js" (
    builtins.readFile "${assets}/input-bridge.js"
  );
in
{
  superbird.gui.webapp = clientthingWebapp;
  superbird.boot.logo = assets + "/appstart.png";
  superbird.installer.manualScript = true;

  environment.systemPackages = with pkgs; [ nodejs ];

  systemd.services.clientthing-input-bridge = {
    description = "ClientThing Input Bridge";
    wantedBy = [ "multi-user.target" ];
    after = [ "network-online.target" ];
    wants = [ "network-online.target" ];
    serviceConfig = {
      Type = "simple";
      ExecStart = "${pkgs.nodejs}/bin/node ${clientthingBridgeJs}";
      Restart = "always";
      RestartSec = "1s";
      User = "root";
      Group = "root";
    };
    environment = {
      BRIDGE_SERVER_URL = "http://127.0.0.1:3000";
      BRIDGE_DEVICE_ID = "input-bridge";
    };
  };

  superbird.stateVersion = "0.2";
  system.stateVersion = "24.11";
}
