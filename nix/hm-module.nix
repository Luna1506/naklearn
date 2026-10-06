self:
{ config, lib, pkgs, ... }:
let
  cfg = config.services.naklearn;
in
{
  options.services.naklearn = {
    enable = lib.mkEnableOption "NAKLearn Lernkarten-Server";
    package = lib.mkOption {
      type = lib.types.package;
      default = self.packages.${pkgs.stdenv.hostPlatform.system}.default;
      description = "NAKLearn-Paket.";
    };
    port = lib.mkOption { type = lib.types.port; default = 8742; };
    dataDir = lib.mkOption {
      type = lib.types.str;
      default = "${config.home.homeDirectory}/.local/share/naklearn";
    };
    claudePath = lib.mkOption {
      type = lib.types.str;
      default = "${config.home.homeDirectory}/.local/bin/claude";
      description = "Pfad zur claude-CLI (nutzt deren Login).";
    };
    claudeModel = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "Optionales Modell für die Kartenerzeugung (null = Standard des Accounts).";
    };
  };

  config = lib.mkIf cfg.enable {
    systemd.user.services.naklearn = {
      Unit = {
        Description = "NAKLearn Lernkarten-Server";
        After = [ "network-online.target" ];
      };
      Service = {
        ExecStart = "${cfg.package}/bin/naklearn-server";
        Environment = [
          "NAKLEARN_PORT=${toString cfg.port}"
          "NAKLEARN_DATA_DIR=${cfg.dataDir}"
          "NAKLEARN_CLAUDE=${cfg.claudePath}"
          "PATH=${config.home.homeDirectory}/.local/bin:/etc/profiles/per-user/${config.home.username}/bin:/run/current-system/sw/bin"
        ] ++ lib.optional (cfg.claudeModel != null) "NAKLEARN_MODEL=${cfg.claudeModel}";
        Restart = "on-failure";
        RestartSec = 5;
      };
      Install.WantedBy = [ "default.target" ];
    };
  };
}
