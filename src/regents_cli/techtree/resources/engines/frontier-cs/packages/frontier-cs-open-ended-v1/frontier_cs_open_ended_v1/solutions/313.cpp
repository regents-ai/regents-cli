// The statement's baseline: the identity permutation 1, 2, ..., n.
#include <cstdio>
int main() {
    int n, q;
    if (scanf("%d %d", &n, &q) != 2) return 0;
    static char s[64];
    for (int i = 0; i < n; i++) scanf("%63s", s);
    for (int i = 0; i < q; i++) { int l, r, k; scanf("%d %d %d", &l, &r, &k); }
    for (int i = 1; i <= n; i++) printf("%d%c", i, i < n ? ' ' : '\n');
    return 0;
}
