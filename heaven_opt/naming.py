from __future__ import annotations

import hashlib

STRATEGY_NAME_WORDS = (
    "etoile",
    "foret",
    "riviere",
    "montagne",
    "ocean",
    "tempete",
    "harmonie",
    "nuage",
    "pluie",
    "lueur",
    "vallee",
    "soleil",
    "orage",
    "saphir",
    "cendre",
    "ivoire",
    "rio",
    "piedra",
    "roble",
    "brasa",
    "estrella",
    "luna",
    "mar",
    "tierra",
    "tormenta",
    "sierra",
    "bosque",
    "isla",
    "puerto",
    "aguila",
    "cometa",
    "rzeka",
    "kamien",
    "dab",
    "iskra",
    "gwiazda",
    "ksiezyc",
    "slonce",
    "morze",
    "ziemia",
    "wiatr",
    "burza",
    "las",
    "pustynia",
    "wyspa",
    "orzel",
    "zubr",
    "rys",
    "polana",
    "dolina",
)


def dictionary_word(seed: str, rank: int = 1) -> str:
    raw = f"{seed}:{int(rank)}".encode()
    idx = int(hashlib.sha1(raw).hexdigest()[:8], 16) % len(STRATEGY_NAME_WORDS)
    return STRATEGY_NAME_WORDS[idx]


def strategy_name_for_rank(run_id: str, rank: int, max_length: int = 120) -> str:
    run_token = str(run_id or "").replace("-", "")[:8] or "run"
    word = dictionary_word(run_token, rank)
    return f"{word}-{run_token}-{int(rank)}"[:max(1, int(max_length))]
