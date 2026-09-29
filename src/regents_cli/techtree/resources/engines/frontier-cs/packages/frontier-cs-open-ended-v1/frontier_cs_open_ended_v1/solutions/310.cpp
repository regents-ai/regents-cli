// The statement's baseline: take ports cheapest first (ties by index) while the budget allows.
#include <bits/stdc++.h>
using namespace std;
int main() {
    int m;
    long long b;
    if (scanf("%d %lld", &m, &b) != 2) return 0;
    vector<long long> cost(m);
    for (auto& c : cost) scanf("%lld", &c);
    for (int i = 0; i < 2 * m; i++) { long long t; scanf("%lld", &t); }
    vector<int> order(m);
    iota(order.begin(), order.end(), 0);
    sort(order.begin(), order.end(), [&](int i, int j) { return cost[i] != cost[j] ? cost[i] < cost[j] : i < j; });
    vector<int> chosen;
    long long spent = 0;
    for (int i : order)
        if (cost[i] <= b - spent) { chosen.push_back(i); spent += cost[i]; }
    sort(chosen.begin(), chosen.end());
    printf("%d\n", (int)chosen.size());
    for (size_t i = 0; i < chosen.size(); i++) printf("%d%c", chosen[i], i + 1 < chosen.size() ? ' ' : '\n');
    return 0;
}
