// The statement's baseline: build no teleport pads.
#include <cstdio>
int main() {
    int v, e, m, n;
    long long c;
    if (scanf("%d %d %d %d %lld", &v, &e, &m, &n, &c) != 5) return 0;
    for (int i = 0; i < 3 * e + 2 * m + 2 * n; i++) { long long t; scanf("%lld", &t); }
    printf("0\n");
    return 0;
}
