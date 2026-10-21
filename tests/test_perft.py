"""Der Zuggenerator der Schach-Engine gegen veröffentlichte Perft-Referenzzahlen.

Perft zählt alle Stellungen bis zu einer Tiefe. Stimmen die Zahlen, erzeugt
die Engine genau die legalen Züge – inklusive Rochade, en passant und
Umwandlung. Quelle der Zahlen: https://www.chessprogramming.org/Perft_Results
"""

import unittest

import chess_engine

KIWIPETE = "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1"
POSITION_3 = "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1"


class PerftTest(unittest.TestCase):
    def assertPerft(self, state, expected):
        for depth, nodes in enumerate(expected, start=1):
            with self.subTest(depth=depth):
                self.assertEqual(chess_engine.perft(state, depth), nodes)

    def test_startstellung(self):
        self.assertPerft(chess_engine.initial_state(), [20, 400, 8902])

    def test_kiwipete(self):
        # Rochaden beider Seiten, en passant, Fesselungen.
        self.assertPerft(chess_engine.state_from_fen(KIWIPETE), [48, 2039])

    def test_position_3(self):
        # Endspiel mit en passant und Abzugsschach.
        self.assertPerft(chess_engine.state_from_fen(POSITION_3), [14, 191, 2812, 43238])


if __name__ == "__main__":
    unittest.main()
