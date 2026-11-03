#include <stdio.h>

__attribute__((noinline)) int parity_select(int x, int flag) {
    if (flag == 7) return x * 3 + 5;
    if (flag < 0) return x - 9;
    return x ^ 0x5a;
}

int main(void) {
    int a = parity_select(11, 7);
    int b = parity_select(11, -1);
    int c = parity_select(11, 0);
    printf("fixture:%d,%d,%d\n", a, b, c);
    return (a == 38 && b == 2 && c == 81) ? 0 : 1;
}
