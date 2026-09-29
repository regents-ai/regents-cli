// The statement's baseline: the K witnesses (0,0), (1,0), ..., (K-1,0).
#include <cstdio>
int main() {
    int n, k;
    long long b;
    if (scanf("%d %d %lld", &n, &k, &b) != 3) return 0;
    for (int i = 0; i < n; i++) { long long p, x, w; scanf("%lld %lld %lld", &p, &x, &w); }
    printf("%d\n", k);
    for (int j = 0; j < k; j++) printf("%d 0\n", j);
    return 0;
}
