# BMad Python runtime diagnosis and recovery

Date: 2026-10-07. Project: `C:\Users\User\Documents\bmadecomm`.

## Proven failure

The failing operation was `uv run _bmad/scripts/resolve_customization.py --skill .agents/skills/bmad-spec --project-root C:/Users/User/Documents/bmadecomm --key workflow`; `uv run _bmad/scripts/memlog.py --help` failed the same way. Adding verbose/offline/no-download/no-cache options did not resolve Windows error 4551.

Code Integrity event **3077**, record **14446**, at `2026-10-07T06:54:51.6053581Z`, identifies `C:\Users\User\.local\bin\uv.exe` as the initiating process and this actual blocked executable:

```text
C:\Users\User\AppData\Local\Temp\.tmplfpzeK\builds-v0\.tmpYtkdIk\Scripts\python.exe
```

Its correlation ID is `{69f9aa23-516c-0007-2634-4a6a6c51dd01}`. Correlated **3089** records report zero signatures / unknown publisher; **3118** reports a Smart App Control block. Enforced policy: `VerifiedAndReputableDesktop`, GUID `{0283ac0f-fff1-49ae-ada1-8a933130cad6}`, version `27555.1000.240208`. Status: `0xc0e90002`. The matching policy file exists in `C:\Windows\System32\CodeIntegrity\CiPolicies\Active`. Registry `VerifiedAndReputablePolicyState=1` supports enforcement being active.

Reproduction outside the tool sandbox also failed: record **14481**, `2026-10-07T06:57:34.6793895Z`, blocked `C:\Users\User\AppData\Local\Temp\.tmpyqFugq\builds-v0\.tmpO78xBV\Scripts\python.exe` under the same policy. The later memlog-help attempt produced record **14492** at `2026-10-07T06:58:43.0614465Z`, blocking `.tmpTbaXB3\builds-v0\.tmpRTQcWc\Scripts\python.exe` in the same Temp root. Temporary paths change and may disappear after uv cleans up; the hash identifies the file content.

Flat SHA-256 for all these launchers:

```text
041C87B3D674BB9002A90A60ECFB6556AF4C8FC594B92DB6C58346802913F17E
```

It exactly matches the installed `C:\Users\User\AppData\Roaming\uv\python\cpython-3.14.8-windows-x86_64-none\Lib\venv\scripts\nt\venvlauncher.exe`, which `Get-AuthenticodeSignature` reports as `NotSigned`. Thus the blocked file is the virtual-environment launcher, not the `WindowsApps\python.exe` alias from PATH.

`uv python find --script ... --resolve-links` originally resolved the base interpreter to `C:\Users\User\AppData\Roaming\uv\python\cpython-3.14.8-windows-x86_64-none\python.exe`. Its SHA-256 is `7AC317D47616D50BFA8BD21565910202506FE3AD10D36B8FE1DF47B071C23BB9`, also `NotSigned`; BUILD contains `20261003`. `uv python list --only-installed` identifies it as managed CPython 3.14.8. [uv documents its managed distribution source](https://docs.astral.sh/uv/guides/install-python/) as python-build-standalone; layout/build metadata alone do not cryptographically prove this local installation's original download provenance.

No other interpreter was found in inspected PythonCore registry locations or standard Python install directories before recovery. AppLocker EXE/DLL and MSI/Script logs had no events in the inspected four-hour window. This does not prove AppLocker is globally absent. `CiTool -lp -json` returned access denied even outside the sandbox, so the complete policy inventory was not obtainable. The responsible policy is nevertheless named directly in the enforcement event.

The sandbox's separate denial of `AppData\Local\uv\cache` produced access-denied errors, not 4551. `--no-cache` avoided that restricted cache during diagnosis; it does not bypass Application Control. Project `uv.toml` now sets `cache-dir = ".local/uv-cache"`, within the writable workspace, so the documented commands need no additional cache flag. `.local/` was already ignored. PowerShell execution policy and administrator command elevation did not cause or fix the unsigned executable block.

## Recovery applied with approval

Downloaded the official [Python 3.14.8 x64 installer](https://www.python.org/downloads/release/python-3148/) to `%TEMP%\bmadecomm-python-3.14.8-amd64.exe`. Its published SHA-256 matched:

```text
759BE887B96E736A3CA886DAF8D575F18FCAE1A09EFAB6902F42D59E8999F8EF
```

Authenticode status was **Valid**, publisher **Python Software Foundation**. Only after verifying both, and receiving tool approval, installed per-user at `C:\Users\User\AppData\Local\Programs\Python\Python314-BMad` (installer exit **0**). No PATH prepend, launcher install, pip, tests, documentation or Tcl/Tk installation was requested. Installer log: `%TEMP%\bmadecomm-python-install.log`.

The signed installed interpreter ran as CPython 3.14.8. A local `.python-version` now contains its absolute executable path. [uv supports interpreter-path requests](https://docs.astral.sh/uv/concepts/python-versions/) and `UV_PYTHON`/`--python` selection. The local pin makes subsequent project-root skill commands resolve to the approved runtime without per-command overrides. It is ignored in Git because the path belongs to this machine; it must be configured independently on other machines. No existing version pin was overwritten.

No Application Control, AppLocker, Defender, registry policy, execution policy or unsigned executable was altered. The unsigned managed installation was preserved. Smart App Control accepted the new runtime through its normal trust mechanism. [Microsoft states that SAC has no per-app exception mechanism](https://support.microsoft.com/en-us/windows/security/threat-malware-protection/smart-app-control-frequently-asked-questions); no custom exception or protection shutdown was attempted.

## Verification and future use

From the project root, use the documented script paths:

```powershell
uv python find --no-cache --offline --no-python-downloads --script _bmad/scripts/resolve_customization.py --resolve-links
uv run --no-cache _bmad/scripts/resolve_customization.py --skill .agents/skills/bmad-spec --project-root C:/Users/User/Documents/bmadecomm --key workflow
uv run --no-cache _bmad/scripts/resolve_config.py --project-root C:/Users/User/Documents/bmadecomm
uv run --no-cache _bmad/scripts/memlog.py --help
```

All succeeded after the local pin. Final verification also succeeded without `--no-cache`, using the project `uv.toml` cache location: both configuration resolvers and actual `memlog.py append` writes ran with the documented `uv run` form. Canonical E02-02 memory was initialized and appended by `memlog.py` in `_bmad-output/specs/spec-e02-02-permission-enforcement/`; no direct writes to that memory were used. Derived specification files reflect those recorded decisions.

For another workstation, an administrator should obtain an organization-approved signed Python 3.11+ distribution, verify vendor/hash/signatures (including its venv launcher), install it through approved software distribution, then point the local project `.python-version` at that executable and rerun these checks. Do not whitelist Temp directories or create an unsigned-launcher exception to SAC. If a separate enterprise policy also rejects the approved signed runtime, collect its new 3077 event and let the policy owner review a narrowly scoped publisher/file rule through the organization's existing deployment process; a policy change requires explicit approval first.
