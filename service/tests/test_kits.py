from algorip.kits import kit_samples, nearest_sample


def test_the_table_holds_both_banks():
    assert len(kit_samples("tr909", "bd")) == 4
    assert len(kit_samples("tr909", "sd")) == 16
    assert len(kit_samples("tr808", "hh")) == 1
    assert kit_samples("tr707", "bd") == [] and kit_samples("tr909", "rd") == []
    assert all(s.fall_ms > 0 for bank in ("tr909", "tr808") for v in ("bd", "sd", "cp", "hh", "oh") for s in kit_samples(bank, v))


def test_nearest_sample_by_the_first_twelve_db_of_fall():
    # measured on the 48:50 Solomun stem: kick 150 ms, offbeat hats 62, clap 65; the 36:40 kick 35
    assert nearest_sample("tr909", "bd", 150).n == 3
    assert nearest_sample("tr909", "bd", 35).n == 0
    assert nearest_sample("tr909", "oh", 62).n == 2
    assert nearest_sample("tr909", "cp", 65).n == 4
    assert nearest_sample("tr808", "hh", 40).n == 0
    assert nearest_sample("tr909", "rd", 40) is None
