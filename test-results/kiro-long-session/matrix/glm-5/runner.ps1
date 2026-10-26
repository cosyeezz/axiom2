Set-Location F:/Axiom/axiom2/app
node scripts/kiro-live-check.mjs matrix-long --model glm-5 --task t4019 --state ../test-results/kiro-long-session/matrix/glm-5/state.json 2>&1 | Out-File -Encoding utf8 ../test-results/kiro-long-session/matrix/glm-5/run.log
$testExitCode = $LASTEXITCODE
$testExitCode | Out-File -Encoding utf8 ../test-results/kiro-long-session/matrix/glm-5/exit-code.txt
exit $testExitCode
