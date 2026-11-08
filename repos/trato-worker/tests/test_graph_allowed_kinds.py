import inspect, re, unittest
from trato_worker import graph_projection
from trato_worker.graph_projection import KINDS, RELATIONS, build_projection


class AllowedKindsTests(unittest.TestCase):
    def test_every_node_and_relation_the_projection_creates_can_be_written(self):
        # The writer refuses anything outside these sets, and that failure stops a project's whole map.
        source = inspect.getsource(build_projection)
        created_nodes = set(re.findall(r"node\([^,]+,[^,]+,'([A-Za-z]+)'", source)) | set(re.findall(r"\('[a-z_]+','([A-Z][A-Za-z]+)'\)", source))
        created_edges = set(re.findall(r"edge\([^,]+,'([A-Z_]+)'", source))
        self.assertGreater(len(created_edges), 10)
        self.assertEqual(created_nodes - KINDS, set())
        self.assertEqual(created_edges - RELATIONS, set())
