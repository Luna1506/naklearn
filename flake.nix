{
  description = "kartei – Lernkarten aus Foliensätzen";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  outputs = { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
      kartei = pkgs.buildNpmPackage {
        pname = "kartei";
        version = "0.1.0";
        src = self;
        nodejs = pkgs.nodejs_24;
        npmDepsHash = "sha256-b5nUQM/3XTP11lUDrutHn2pAhTJtB3QFY3edLFxYRXA=";
        npmBuildScript = "build";
        dontNpmPrune = true;
        nativeBuildInputs = [ pkgs.makeWrapper ];
        installPhase = ''
          runHook preInstall
          mkdir -p $out/lib/kartei $out/bin
          cp -r package.json node_modules packages apps $out/lib/kartei/
          makeWrapper ${pkgs.nodejs_24}/bin/node $out/bin/kartei-server \
            --add-flags $out/lib/kartei/apps/server/src/main.ts \
            --prefix PATH : ${pkgs.lib.makeBinPath [ pkgs.poppler-utils ]} \
            --set-default KARTEI_WEB_DIR $out/lib/kartei/apps/client/dist
          runHook postInstall
        '';
      };
    in {
      packages.${system}.default = kartei;
      homeManagerModules.default = import ./nix/hm-module.nix self;
      devShells.${system}.default = pkgs.mkShell {
        packages = [ pkgs.nodejs_24 pkgs.poppler-utils pkgs.prefetch-npm-deps ];
      };
    };
}
