// The statement's baseline: hire nobody.
#include <cstdio>
int main() {
    int l, n, m;
    if (scanf("%d %d %d", &l, &n, &m) != 3) return 0;
    static char s[8192];
    scanf("%8191s", s);
    for (int i = 0; i < n; i++) { int x, h, d; char c[4]; scanf("%d %3s %d %d", &x, c, &h, &d); }
    for (int j = 0; j < m; j++) { int a, b, w; scanf("%d %d %d", &a, &b, &w); }
    for (int i = 0; i < n; i++) printf("-1\n");
    return 0;
}
