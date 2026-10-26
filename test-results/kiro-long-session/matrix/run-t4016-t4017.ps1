Set-Location F:/Axiom/axiom2/app
node scripts/kiro-live-check.mjs matrix-long --model deepseek-3.2 --task t4016 --state ../test-results/kiro-long-session/matrix/deepseek-3.2/state.json 2>&1 | Out-File -Encoding utf8 ../test-results/kiro-long-session/matrix/deepseek-3.2/run.log
$deepseekExit = $LASTEXITCODE
$deepseekExit | Out-File -Encoding utf8 ../test-results/kiro-long-session/matrix/deepseek-3.2/exit-code.txt
node scripts/kiro-live-check.mjs matrix-long --model minimax-m2.5 --task t4017 --state ../test-results/kiro-long-session/matrix/minimax-m2.5/state.json 2>&1 | Out-File -Encoding utf8 ../test-results/kiro-long-session/matrix/minimax-m2.5/run.log
$minimaxExit = $LASTEXITCODE
$minimaxExit | Out-File -Encoding utf8 ../test-results/kiro-long-session/matrix/minimax-m2.5/exit-code.txt
