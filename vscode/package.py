"""Builds agent-cockpit-<version>.vsix without npm: a VSIX is a zip with a manifest."""

import json
import zipfile
from pathlib import Path

ROOT = Path(__file__).parent
REPO_ROOT = ROOT.parent
FILES = ["package.json", "extension.js", "group.js", "inbox.js", "media/icon.svg", "media/icon.png"]

pkg = json.loads((ROOT / "package.json").read_text())
ident = f'{pkg["publisher"]}.{pkg["name"]}'

CONTENT_TYPES = """<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension=".json" ContentType="application/json"/>
  <Default Extension=".js" ContentType="application/javascript"/>
  <Default Extension=".svg" ContentType="image/svg+xml"/>
  <Default Extension=".png" ContentType="image/png"/>
  <Default Extension=".md" ContentType="text/markdown"/>
  <Default Extension=".txt" ContentType="text/plain"/>
  <Default Extension=".vsixmanifest" ContentType="text/xml"/>
</Types>
"""

MANIFEST = f"""<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata>
    <Identity Language="en-US" Id="{pkg["name"]}" Version="{pkg["version"]}" Publisher="{pkg["publisher"]}"/>
    <DisplayName>{pkg["displayName"]}</DisplayName>
    <Description xml:space="preserve">{pkg["description"]}</Description>
    <Icon>extension/media/icon.png</Icon>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="{pkg["engines"]["vscode"]}"/>
    </Properties>
    <License>extension/LICENSE.txt</License>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code"/>
  </Installation>
  <Dependencies/>
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/>
    <Asset Type="Microsoft.VisualStudio.Services.Icons.Default" Path="extension/media/icon.png" Addressable="true"/>
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true"/>
    <Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE.txt" Addressable="true"/>
  </Assets>
</PackageManifest>
"""

out = ROOT / f'{pkg["name"]}-{pkg["version"]}.vsix'
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as vsix:
    vsix.writestr("[Content_Types].xml", CONTENT_TYPES)
    vsix.writestr("extension.vsixmanifest", MANIFEST)
    for name in FILES:
        vsix.write(ROOT / name, f"extension/{name}")
    if (REPO_ROOT / "README.md").exists():
        vsix.write(REPO_ROOT / "README.md", "extension/README.md")
    if (REPO_ROOT / "LICENSE").exists():
        vsix.write(REPO_ROOT / "LICENSE", "extension/LICENSE.txt")
print(f"{out} ({ident})")
