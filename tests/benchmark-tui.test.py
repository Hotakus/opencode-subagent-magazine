import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('benchmark_tui', ROOT / 'scripts/benchmark-tui.py')
benchmark = importlib.util.module_from_spec(spec)
spec.loader.exec_module(benchmark)


class BenchmarkProfileTests(unittest.TestCase):
    def summary(self, urls, expected):
        temporary_root = Path('/tmp/opencode')
        temporary_root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='subagent-profile-test-', dir=temporary_root) as directory:
            profile = Path(directory) / 'test.cpuprofile'
            profile.write_text(json.dumps({
                'nodes': [{'id': index + 1, 'callFrame': {'url': url, 'functionName': 'poll'}}
                          for index, url in enumerate(urls)],
                'samples': list(range(1, len(urls) + 1)),
                'timeDeltas': [100] * len(urls),
            }))
            return benchmark.profile_summary(profile, expected)

    def test_worktree_name_does_not_need_to_contain_the_package_name(self):
        expected = 'file:///tmp/opencode/pr-base/dist/v2.js'
        self.assertTrue(self.summary([expected], expected)['implementationVerified'])

    def test_a_second_implementation_cannot_pass_as_the_expected_build(self):
        expected = 'file:///tmp/opencode/pr-base/dist/v2.js'
        wrong = 'file:///projects/opencode-subagent-magazine/dist/v2.js'
        self.assertFalse(self.summary([expected, wrong], expected)['implementationVerified'])

    def test_no_matching_plugin_frames_do_not_verify_an_implementation(self):
        self.assertFalse(self.summary(['file:///opencode/core.js'], 'file:///tmp/pr-base/dist/v2.js')['implementationVerified'])


if __name__ == '__main__':
    unittest.main()
