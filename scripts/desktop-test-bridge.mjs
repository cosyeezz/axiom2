// Test builds record the exact production Command instead of spawning an MSI.
// This module is used by the desktop builder, never by the shipped application.
export const installerRecordName = "axiom-test-installer-launches.jsonl";
export function instrumentInstaller(bridge) {
  const launch = /(Command::new\(system\.join\("System32\/msiexec\.exe"\)\)[\s\S]*?)\.spawn\(\)\.map_err\(\|e\| format!\("无法打开安装向导：\{e\}"\)\)\?;/g;
  const matches = [...bridge.matchAll(launch)];
  if (matches.length !== 1) throw Error("Expected exactly one native installer launch for the test replacement");
  const recorded = bridge.replace(launch, (_match, command) => `axiom_test_installer(${command.trim()})?;`);
  return recorded + `
#[cfg(windows)]
fn axiom_test_installer(command: &mut Command) -> Result<(), String> {
    use std::io::Write;
    let record = json!({
        "program": command.get_program().to_string_lossy(),
        "args": command.get_args().map(|arg| arg.to_string_lossy().into_owned()).collect::<Vec<_>>()
    });
    let mut file = fs::OpenOptions::new().create(true).append(true)
        .open(data_root()?.join("${installerRecordName}")).map_err(|e| e.to_string())?;
    writeln!(file, "{}", record).map_err(|e| e.to_string())
}
`;
}
