#!/usr/bin/env python3
"""Unit tests for the conservative BD TOPO cycling profile."""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.prepare_road_graph import bicycle_directions


def dirs(**properties):
    base = {
        "nature": "Route à 1 chaussée",
        "etat_de_l_objet": "En service",
        "prive": False,
        "acces_vehicule_leger": "Libre",
        "sens_de_circulation": "Double sens",
        "nature_de_la_restriction": "",
        "amenagement_cyclable_gauche": "",
        "amenagement_cyclable_droit": "",
        "sens_amenagement_cyclable_gauche": "",
        "sens_amenagement_cyclable_droit": "",
    }
    base.update(properties)
    return bicycle_directions(base)


def main():
    assert dirs(sens_de_circulation="Sens direct") == {1}
    assert dirs(sens_de_circulation="Sens inverse") == {-1}
    assert dirs(sens_de_circulation="Double sens") == {1, -1}

    assert dirs(
        sens_de_circulation="Sens direct",
        nature_de_la_restriction="Double sens cyclable non matérialisé",
    ) == {1, -1}

    assert dirs(
        sens_de_circulation="Sens direct",
        amenagement_cyclable_droit="Piste cyclable",
        sens_amenagement_cyclable_droit="Sens inverse",
    ) == {1, -1}

    assert dirs(
        nature="Piste cyclable",
        acces_vehicule_leger="Physiquement impossible",
        sens_de_circulation="Sans objet",
    ) == {1, -1}

    assert dirs(
        acces_vehicule_leger="Physiquement impossible",
        nature_de_la_restriction="Voie verte",
        sens_de_circulation="Sans objet",
    ) == {1, -1}

    assert dirs(prive=True) == set()
    assert dirs(prive=True, nature_de_la_restriction="Piste cyclable") == set()
    assert dirs(nature="Escalier", amenagement_cyclable_droit="Goulotte ou rampe") == set()
    assert dirs(etat_de_l_objet="Projet") == set()
    assert dirs(
        acces_vehicule_leger="Restreint aux ayants droit",
        nature_de_la_restriction="",
    ) == set()

    print("bike profile tests: ok")


if __name__ == "__main__":
    main()
