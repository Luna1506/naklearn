self:
{ config, lib, pkgs, ... }:
let
  cfg = config.services.kartei;
in
{
  options.services.kartei = {
    enable = lib.mkEnableOption "kartei Lernkarten-Server";
    package = lib.mkOption {
      type = lib.types.package;
      default = self.packages.${pkgs.stdenv.hostPlatform.system}.default;
      description = "kartei-Paket.";
    };
    port = lib.mkOption { type = lib.types.port; default = 8742; };
    dataDir = lib.mkOption {
      type = lib.types.str;
      default = "${config.home.homeDirectory}/.local/share/kartei";
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
    systemd.user.services.kartei = {
      Unit = {
        Description = "kartei Lernkarten-Server";
        After = [ "network-online.target" ];
      };
      Service = {
        ExecStart = "${cfg.package}/bin/kartei-server";
        Environment = [
          "KARTEI_PORT=${toString cfg.port}"
          "KARTEI_DATA_DIR=${cfg.dataDir}"
          "KARTEI_CLAUDE=${cfg.claudePath}"
          "PATH=${config.home.homeDirectory}/.local/bin:/etc/profiles/per-user/${config.home.username}/bin:/run/current-system/sw/bin"
        ] ++ lib.optional (cfg.claudeModel != null) "KARTEI_MODEL=${cfg.claudeModel}";
        Restart = "on-failure";
        RestartSec = 5;
      };
      Install.WantedBy = [ "default.target" ];
    };
  };
}
