import hashlib
import itertools



NODES = {
    1: "NODE_A",
    2: "NODE_B",
    3: "RESCUE",
}



def create_next_root(current_root, node_id):
    """
    Equivalent to:

        createNextRoot(currentRoot, nodeId)

    in mesh_common.h

    ESP32 code:
        input[0] = currentRoot
        input[1] = currentRoot >> 8
        input[2] = currentRoot >> 16
        input[3] = currentRoot >> 24
        input[4] = nodeId

    Then SHA256 and take first 4 bytes
    as little-endian uint32.
    """

    data = bytearray()

    # uint32_t stored little-endian
    data += current_root.to_bytes(4, byteorder="little")

    # node ID
    data += bytes([node_id])

    digest = hashlib.sha256(data).digest()

    # Same as:
    #
    # digest[0]
    # | digest[1] << 8
    # | digest[2] << 16
    # | digest[3] << 24

    result = int.from_bytes(
        digest[:4],
        byteorder="little"
    )

    return result



def node_mask(node_id):
    return 1 << (node_id - 1)


def visited_mask(path):
    mask = 0

    for node in path:
        mask |= node_mask(node)

    return mask



def calculate_path_root(origin_root, path):
    """
    Starting from origin_root, apply each receiving node
    in the path.
    """

    root = origin_root
    roots = [root]

    for node in path:
        root = create_next_root(root, node)
        roots.append(root)

    return root, roots


def find_paths(origin_root, final_root, origin_node):
    """
    Try every possible path through the three nodes.

    The origin node is NOT treated as a relay initially.

    Example:

        origin_node = 1

    Possible paths include:

        NODE_A -> NODE_B -> RESCUE
        NODE_A -> RESCUE -> NODE_B

    etc.
    """

    other_nodes = [
        node for node in NODES
        if node != origin_node
    ]

    matches = []

    # Try paths of length 0, 1 and 2
    # because there are only 3 nodes.
    for length in range(len(other_nodes) + 1):

        for permutation in itertools.permutations(
            other_nodes,
            length
        ):

            path = [origin_node] + list(permutation)

            # The origin itself does NOT cause createNextRoot.
            relay_nodes = path[1:]

            calculated_final, roots = calculate_path_root(
                origin_root,
                relay_nodes
            )

            if calculated_final == final_root:

                matches.append({
                    "path": path,
                    "relay_nodes": relay_nodes,
                    "roots": roots,
                    "visited_mask": visited_mask(path),
                    "hop_count": len(relay_nodes)
                })

    return matches



def print_result(matches, target_node=None):

    if not matches:
        print()
        print("NO MATCH FOUND")
        print("-----------------------------")
        print("The supplied origin root and")
        print("final root do not correspond")
        print("to any possible path.")
        return

    print()
    print("=" * 60)
    print(f"FOUND {len(matches)} POSSIBLE PATH(S)")
    print("=" * 60)

    for number, result in enumerate(matches, 1):

        path = result["path"]
        roots = result["roots"]

        print()
        print(f"PATH #{number}")
        print("-" * 60)

        print(
            " -> ".join(
                NODES[node]
                for node in path
            )
        )

        print()
        print("Root progression:")

        print(
            f"  ROOT0 = 0x{roots[0]:08X}"
        )

        for i, node in enumerate(
            result["relay_nodes"],
            start=1
        ):
            print(
                f"  + {NODES[node]}"
                f" -> 0x{roots[i]:08X}"
            )

        print()
        print(
            f"Hop count   : {result['hop_count']}"
        )

        print(
            f"Visited mask: "
            f"0x{result['visited_mask']:02X}"
        )

        if target_node is not None:

            if target_node in path:
                print(
                    f"TARGET {NODES[target_node]}: "
                    "YES - participated"
                )
            else:
                print(
                    f"TARGET {NODES[target_node]}: "
                    "NO - did not participate"
                )

        print()



if __name__ == "__main__":

    print("=" * 60)
    print("RESCUE MESH ROUTING PATH CHECKER")
    print("=" * 60)

    print()
    print("Nodes:")
    print("  1 = NODE_A")
    print("  2 = NODE_B")
    print("  3 = RESCUE")

    print()

    origin_node = int(
        input("Origin node ID (1/2): ")
    )

    origin_root_text = input(
        "Origin root (hex, e.g. 0x12345678): "
    )

    final_root_text = input(
        "Final root (hex, e.g. 0xABCDEF12): "
    )

    target_text = input(
        "Node ID to check (1/2/3, or Enter for none): "
    )

    origin_root = int(
        origin_root_text,
        16
    )

    final_root = int(
        final_root_text,
        16
    )

    target_node = None

    if target_text.strip():
        target_node = int(target_text)

    matches = find_paths(
        origin_root,
        final_root,
        origin_node
    )

    print_result(
        matches,
        target_node
    )