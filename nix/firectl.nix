# firectl is closed-source; Fireworks publishes gzipped static binaries per
# versioned path, so we pin version + hashes here. Latest version is listed in
# the public bucket (delimiter + max-keys are required; the bare listing
# truncates at 100 keys and hides current releases):
#   curl -s 'https://storage.googleapis.com/fireworks-public?prefix=firectl/&delimiter=/&max-keys=1000' | grep -oE '<Prefix>firectl/[0-9][^<]*/' | sort -V | tail -1
# Then per platform: curl -sSL ".../<version>/<platform>.gz" -o /tmp/f.gz && nix hash file /tmp/f.gz
{ lib, stdenvNoCC, fetchurl }:

let
  version = "1.8.14";

  platforms = {
    "aarch64-darwin" = "darwin-arm64";
    "x86_64-linux" = "linux-amd64";
    "aarch64-linux" = "linux-arm64";
  };

  platform =
    platforms.${stdenvNoCC.hostPlatform.system}
      or (throw "firectl: unsupported system ${stdenvNoCC.hostPlatform.system}");

  hashes = {
    "darwin-arm64" = "sha256-klHdG/7tuLBMYKyKpHLTyXEB7PfRdlAQKvHJS1fG800=";
    "linux-amd64" = "sha256-D7h29bO4Yabpk+NaabFH+W74RmYzQawiEsk7LQY+Yec=";
    "linux-arm64" = "sha256-vgcevC5RsIoynG36RKw5CeqrR7PAWR/tjECs2w1hIeM=";
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
