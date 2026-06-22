import type { Target } from "@mping/shared";

export interface TreeNode {
  name: string;
  /** Full slash-delimited path, e.g. "EMEA/Backbone". */
  path: string;
  children: Map<string, TreeNode>;
  targets: Target[];
}

/** Split a group_name into clean path segments ("EMEA / Core" -> ["EMEA","Core"]). */
export function groupSegments(groupName: string | null | undefined): string[] {
  return (groupName ?? "")
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Cumulative ancestor paths for a group, e.g. ["EMEA","EMEA/Core"]. */
export function ancestorPaths(groupName: string | null | undefined): string[] {
  const segs = groupSegments(groupName);
  const paths: string[] = [];
  let acc = "";
  for (const seg of segs) {
    acc = acc ? `${acc}/${seg}` : seg;
    paths.push(acc);
  }
  return paths;
}

/** Build a nested tree from targets' slash-delimited group names. */
export function buildTree(targets: Target[]): TreeNode {
  const root: TreeNode = { name: "", path: "", children: new Map(), targets: [] };
  for (const t of targets) {
    const segs = groupSegments(t.group_name);
    let node = root;
    let path = "";
    for (const seg of segs) {
      path = path ? `${path}/${seg}` : seg;
      let child = node.children.get(seg);
      if (!child) {
        child = { name: seg, path, children: new Map(), targets: [] };
        node.children.set(seg, child);
      }
      node = child;
    }
    node.targets.push(t);
  }
  return root;
}

/** Total number of targets at or below a node. */
export function countTargets(node: TreeNode): number {
  let n = node.targets.length;
  for (const child of node.children.values()) n += countTargets(child);
  return n;
}

/** Sorted child nodes by name. */
export function sortedChildren(node: TreeNode): TreeNode[] {
  return [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Sorted targets by name. */
export function sortedTargets(targets: Target[]): Target[] {
  return [...targets].sort((a, b) => a.name.localeCompare(b.name));
}
