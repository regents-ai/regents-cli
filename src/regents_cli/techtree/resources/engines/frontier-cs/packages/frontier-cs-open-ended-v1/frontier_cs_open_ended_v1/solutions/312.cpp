// One team walks every trail in a depth-first sweep from glade 1 and back; the other teams stay home.
#include <bits/stdc++.h>
using namespace std;
int main() {
    int n, m, k;
    if (scanf("%d %d %d", &n, &m, &k) != 3) return 0;
    vector<int> X(m + 1), Y(m + 1);
    vector<vector<int>> adj(n + 1);
    for (int i = 1; i <= m; i++) {
        long long c;
        scanf("%d %d %lld", &X[i], &Y[i], &c);
        adj[X[i]].push_back(i);
        if (X[i] != Y[i]) adj[Y[i]].push_back(i);
    }
    // Signed id for walking trail i out of glade u.
    auto step = [&](int i, int u) { return X[i] == u ? i : -i; };
    auto other = [&](int i, int u) { return X[i] == u ? Y[i] : X[i]; };
    vector<int> walk, next(n + 1, 0);
    vector<char> used(m + 1, 0), seen(n + 1, 0);
    vector<pair<int, int>> stack = {{1, 0}};  // (glade, trail that led here)
    seen[1] = 1;
    while (!stack.empty()) {
        int u = stack.back().first;
        if (next[u] == (int)adj[u].size()) {
            int back = stack.back().second;
            stack.pop_back();
            if (back) walk.push_back(step(back, u));
            continue;
        }
        int i = adj[u][next[u]++];
        if (used[i]) continue;
        used[i] = 1;
        int v = other(i, u);
        walk.push_back(step(i, u));
        if (v == u) continue;
        if (seen[v]) { walk.push_back(step(i, v)); continue; }
        seen[v] = 1;
        stack.push_back({v, i});
    }
    printf("%d", (int)walk.size());
    for (int a : walk) printf(" %d", a);
    printf("\n");
    for (int j = 1; j < k; j++) printf("0\n");
    return 0;
}
