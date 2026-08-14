# firectl is closed-source; Fireworks publishes gzipped static binaries per
# versioned path, so we pin version + hashes here. Latest version is listed in
# the public bucket:
#   curl 'https://storage.googleapis.com/fireworks-public?prefix=firectl/'
{ lib, stdenvNoCC, fetchurl }:

let
  version = "1.7.36";

  platforms = {
    "aarch64-darwin" = "darwin-arm64";
    "x86_64-darwin" = "darwin-amd64";
    "x86_64-linux" = "linux-amd64";
    "aarch64-linux" = "linux-arm64";
  };

  platform =
    platforms.${stdenvNoCC.hostPlatform.system}
      or (throw "firectl: unsupported system ${stdenvNoCC.hostPlatform.system}");

  hashes = {
    "darwin-arm64" = "sha256-3jdAFphtRqNMJyijrf8wqesrvzs9SujY3PP4bqwJ678=";
    "darwin-amd64" = "sha256-0/3oUAjfdgl9BTllBDGkO8Rg3F5Hl8KhF09bWEIbMvs=";
    "linux-amd64" = "sha256-wvfymj0BGcayNGzYAp+BMQkSQAlT/9RW59VLHyFsqPM=";
    "linux-arm64" = "sha256-/nmIM2QVpH4X2kIlappxwszoiplkWZF/KgThG1VKMyo=";
  };
in
stdenvNoCC.mkDerivation {
  pname = "firectl";
  inherit version;

  src = fetchurl {
    url = "https://storage.googleapis.com/fireworks-public/firectl/${version}/${platform}.gz";
    hash = hashes.${platform};
  };

  dontUnpack = true;

  installPhase = ''
    runHook preInstall
    gzip -dc $src > firectl
    install -Dm755 firectl $out/bin/firectl
    runHook postInstall
  '';

  meta = {
    description = "CLI for the Fireworks AI platform";
    homepage = "https://docs.fireworks.ai/tools-sdks/firectl/firectl";
    license = lib.licenses.unfree;
    mainProgram = "firectl";
    platforms = builtins.attrNames platforms;
  };
}
