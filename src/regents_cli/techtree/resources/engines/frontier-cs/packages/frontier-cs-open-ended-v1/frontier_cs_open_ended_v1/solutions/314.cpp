// The statement's baseline: install no retuners.
#include <cstdio>
int main() {
    int n, m, t, k;
    if (scanf("%d %d %d %d", &n, &m, &t, &k) != 4) return 0;
    for (long long i = 0; i < 2LL * n + 2LL * (n - 1) + 2LL * t; i++) { long long x; scanf("%lld", &x); }
    printf("0\n");
    return 0;
}
