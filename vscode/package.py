"""Builds agent-cockpit-<version>.vsix without npm: a VSIX is a zip with a manifest."""

import json
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).parent
REPO_ROOT = ROOT.parent
FILES = [
    "package.json",
    "extension.js",
    "group.js",
    "inbox.js",
    "media/icon.svg",
    "media/icon.png",
    "media/inbox.css",
    "media/inbox.js",
]

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
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="{pkg["name"]}" Version="{pkg["version"]}" Publisher="{pkg["publisher"]}"/>
    <DisplayName>{pkg["displayName"]}</DisplayName>
    <Description xml:space="preserve">{pkg["description"]}</Description>
    <Tags>{",".join(pkg.get("keywords", []))}</Tags>
    <Categories>{",".join(pkg.get("categories", []))}</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Icon>extension/media/icon.png</Icon>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="{pkg["engines"]["vscode"]}"/>
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value=""/>
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value=""/>
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="ui,workspace"/>
      <Property Id="Microsoft.VisualStudio.Code.LocalizedLanguages" Value=""/>
      <Property Id="Microsoft.VisualStudio.Services.Links.Source" Value="{pkg.get("repository", {}).get("url", "")}.git"/>
      <Property Id="Microsoft.VisualStudio.Services.Links.Getstarted" Value="{pkg.get("repository", {}).get("url", "")}.git"/>
      <Property Id="Microsoft.VisualStudio.Services.Links.GitHub" Value="{pkg.get("repository", {}).get("url", "")}.git"/>
      <Property Id="Microsoft.VisualStudio.Services.Links.Support" Value="{pkg.get("bugs", {}).get("url", "")}"/>
      <Property Id="Microsoft.VisualStudio.Services.Links.Learn" Value="{pkg.get("homepage", "")}"/>
      <Property Id="Microsoft.VisualStudio.Services.GitHubFlavoredMarkdown" Value="true"/>
      <Property Id="Microsoft.VisualStudio.Services.Content.Pricing" Value="Free"/>
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
    readme_path = REPO_ROOT / "README.md" if (REPO_ROOT / "README.md").exists() else ROOT / "README.md"
    if readme_path.exists():
        readme = readme_path.read_text()
        # VS Code Marketplace requires absolute HTTPS URLs for images and blocks custom SVGs
        raw_base = "https://raw.githubusercontent.com/kaiketsu-labs/agent-cockpit/main/"
        readme = readme.replace('src="assets/', f'src="{raw_base}assets/')
        readme = readme.replace('(assets/', f'({raw_base}assets/')
        readme = readme.replace('assets/sidebar.svg', 'assets/sidebar.png')
        readme = readme.replace('href="LICENSE"', 'href="https://github.com/kaiketsu-labs/agent-cockpit/blob/main/LICENSE"')
        vsix.writestr("extension/README.md", readme)
    if (REPO_ROOT / "LICENSE").exists():
        vsix.write(REPO_ROOT / "LICENSE", "extension/LICENSE.txt")
print(f"{out} ({ident})")

if "--install" in sys.argv:
    code_bin = shutil.which("code")
    if not code_bin:
        for candidate in ["/opt/homebrew/bin/code", "/usr/local/bin/code"]:
            if Path(candidate).exists():
                code_bin = candidate
                break
    if not code_bin:
        print("Error: 'code' command not found in PATH.")
        print("Install it via VS Code Command Palette: 'Shell Command: Install code command in PATH'")
        sys.exit(1)

    cmd = [code_bin, "--install-extension", str(out), "--force"]
    if "--profile" in sys.argv:
        idx = sys.argv.index("--profile")
        if idx + 1 < len(sys.argv):
            profile_name = sys.argv[idx + 1]
            cmd.extend(["--profile", profile_name])
            print(f"Installing {out.name} into VS Code profile '{profile_name}'...")
        else:
            print("Error: --profile requires a profile name argument.")
            sys.exit(1)
    else:
        print(f"Installing {out.name} into default VS Code profile...")

    res = subprocess.run(cmd)
    if res.returncode == 0:
        print("Installation complete! Reload VS Code (Developer: Reload Window) to use the new build.")
    else:
        sys.exit(res.returncode)
