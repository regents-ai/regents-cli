// The statement's baseline: sort sensors by (x, y, index), split into K blocks, one hub per block at its centroid.
#include <bits/stdc++.h>
using namespace std;
int main() {
    int n, k;
    double p, a, b;
    if (scanf("%d %d %lf %lf %lf", &n, &k, &p, &a, &b) != 5) return 0;
    vector<double> x(n), y(n), d(n);
    for (int j = 0; j < n; j++) scanf("%lf %lf %lf", &x[j], &y[j], &d[j]);
    vector<int> order(n);
    iota(order.begin(), order.end(), 0);
    sort(order.begin(), order.end(), [&](int i, int j) {
        if (x[i] != x[j]) return x[i] < x[j];
        if (y[i] != y[j]) return y[i] < y[j];
        return i < j;
    });
    vector<long double> hx, hy;
    vector<int> hub(n);
    for (int t = 1; t <= k; t++) {
        int lo = (int)((long long)(t - 1) * n / k), hi = (int)((long long)t * n / k);
        if (lo >= hi) continue;
        long double mx = 0, my = 0;
        for (int i = lo; i < hi; i++) { mx += x[order[i]]; my += y[order[i]]; }
        hx.push_back(mx / (hi - lo));
        hy.push_back(my / (hi - lo));
        for (int i = lo; i < hi; i++) hub[order[i]] = (int)hx.size();
    }
    printf("%d\n", (int)hx.size());
    for (size_t i = 0; i < hx.size(); i++) printf("%.17g %.17g\n", (double)hx[i], (double)hy[i]);
    for (int j = 0; j < n; j++) printf("%d\n", hub[j]);
    return 0;
}
