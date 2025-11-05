
from heaven_opt.combo_generator import generate_alloc_patterns


def test_allocation_normalization_quantization():
    k = 3
    pats = generate_alloc_patterns(k, step=5, max_patterns=5)
    assert len(pats) >= 3
    for p in pats:
        assert len(p) == k
        assert sum(p) == 100
        for x in p:
            assert int(x) % 5 == 0
