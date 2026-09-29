// The statement's baseline: oscillators by weighted degree (high first, ties by index) on evenly spaced bays.
#include <bits/stdc++.h>
using namespace std;
int main() {
    int t;
    if (scanf("%d", &t) != 1) return 0;
    while (t--) {
        int n, r;
        long long m;
        scanf("%d %lld %d", &n, &m, &r);
        for (int i = 0; i < n; i++) { long long p, q; scanf("%lld %lld", &p, &q); }
        vector<long long> deg(n + 1, 0);
        for (int i = 0; i < r; i++) {
            int u, v; long long w;
            scanf("%d %d %lld", &u, &v, &w);
            deg[u] += w; deg[v] += w;
        }
        vector<int> order(n);
        iota(order.begin(), order.end(), 1);
        sort(order.begin(), order.end(), [&](int a, int b) { return deg[a] != deg[b] ? deg[a] > deg[b] : a < b; });
        vector<long long> bay(n + 1, 0);
        for (int k = 0; k < n; k++) bay[order[k]] = n == 1 ? 0 : (long long)k * (m - 1) / (n - 1);
        for (int i = 1; i <= n; i++) printf("%lld%c", bay[i], i < n ? ' ' : '\n');
    }
    return 0;
}
