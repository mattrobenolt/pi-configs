{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-parts.url = "github:hercules-ci/flake-parts";
    mattware = {
      url = "github:mattrobenolt/nixpkgs";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    inputs@{ flake-parts, ... }:
    flake-parts.lib.mkFlake { inherit inputs; } {
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];

      perSystem =
        { pkgs, self', system, ... }:
        {
          # firectl ships as a closed-source binary; allow just that one.
          _module.args.pkgs = import inputs.nixpkgs {
            inherit system;
            config.allowUnfreePredicate =
              pkg: builtins.elem (inputs.nixpkgs.lib.getName pkg) [ "firectl" ];
          };

          packages.firectl = pkgs.callPackage ./nix/firectl.nix { };

          devShells.default = pkgs.mkShell {
            packages =
              with pkgs;
              [
                fd
                zstd
                nodejs
                python3
                zellij
                nushell
                zoxide
                jq
                gh
                pnpm
                zig_0_16
                inputs.mattware.packages.${system}.skills-ref
                self'.packages.firectl
              ]
              ++ lib.optionals stdenv.hostPlatform.isLinux [ chromium ];
            env.NPM_CONFIG_MIN_RELEASE_AGE = "0";
          };
        };
    };
}
