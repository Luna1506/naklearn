{
  description = "NAKLearn – Lernkarten aus Foliensätzen (NORDAKADEMIE)";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  outputs = { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
      naklearn = pkgs.buildNpmPackage {
        pname = "naklearn";
        version = "0.1.0";
        src = self;
        nodejs = pkgs.nodejs_24;
        npmDepsHash = "sha256-m2ClP6Sh1vQ67A15BOHgM9+NU7zfv/YSyb1y2x1Xogg=";
        npmBuildScript = "build";
        dontNpmPrune = true;
        nativeBuildInputs = [ pkgs.makeWrapper ];
        installPhase = ''
          runHook preInstall
          mkdir -p $out/lib/naklearn $out/bin
          cp -r package.json node_modules packages apps $out/lib/naklearn/
          makeWrapper ${pkgs.nodejs_24}/bin/node $out/bin/naklearn-server \
            --add-flags $out/lib/naklearn/apps/server/src/main.ts \
            --prefix PATH : ${pkgs.lib.makeBinPath [ pkgs.poppler-utils ]} \
            --set-default NAKLEARN_WEB_DIR $out/lib/naklearn/apps/client/dist
          runHook postInstall
        '';
      };
    in {
      packages.${system}.default = naklearn;
      homeManagerModules.default = import ./nix/hm-module.nix self;
      devShells.${system}.default = pkgs.mkShell {
        packages = [ pkgs.nodejs_24 pkgs.poppler-utils pkgs.prefetch-npm-deps pkgs.jdk21 ];
        shellHook = ''
          export JAVA_HOME=${pkgs.jdk21.home}
          export ANDROID_HOME=$HOME/Android/Sdk
          export ANDROID_SDK_ROOT=$ANDROID_HOME
          export PATH=$ANDROID_HOME/platform-tools:$PATH
        '';
      };
    };
}
