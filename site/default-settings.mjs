// Site defaults supplied via the settings export.
export const SITE_DEFAULTS = {
  "format": "tours-settings",
  "version": 1,
  "display": {
    "railMagnetMaxScale": 150000,
    "isochronePocketScale": 1.4,
    "railMagnetism": true,
    "showBusLabels": false,
    "busEpciColors": true,
    "busEpciTone": -0.4,
    "terWidth": 3.3,
    "tramWidth": 2.1,
    "bhnsWidth": 0.5,
    "stationRadius": 1.5,
    "railStationRadius": 4.6,
    "labelScale": 0.8,
    "communeBorderWidth": 0.3,
    "epciBorderWidth": 1.2,
    "isochroneOpacity": 1,
    "communeFillOpacity": 0,
    "epciFillOpacity": 0.2,
    "communeColor": "#bec5fe",
    "backgroundColor": "#f4fbfb",
    "routeColors": {
      "TER K1": "#080808",
      "TER P1": "#080808",
      "TER P21": "#080808",
      "TER P65": "#080808",
      "TER K39": "#080808",
      "TER P30": "#080808",
      "TER P33": "#080808",
      "NAVETTE": "#646362",
      "TER K16": "#080808",
      "TER K6+": "#080808",
      "TER P6": "#080808",
      "TER P7": "#080808",
      "TER P17": "#080808",
      "TER P166": "#080808",
      "TER P11": "#080808",
      "TER P31": "#080808",
      "BUS Cars Rémi 405": "#9e0089"
    },
    "epciColors": {
      "200030385": "#206ed5",
      "200043065": "#e4a172",
      "200043081": "#45ab3f",
      "200071587": "#ceb33b",
      "200071876": "#7f8cd7",
      "200072072": "#35abb1",
      "200072650": "#63cce3",
      "200072668": "#2a4bcf",
      "200072981": "#76a7db",
      "200073161": "#23b87f",
      "200073237": "#dc6a6c",
      "243700499": "#c93667",
      "243700754": "#eec772",
      "243700820": "#6cd0af"
    },
    "isochroneStops": [
      {
        "t": 0,
        "color": "#56d600",
        "alpha": 1
      },
      {
        "t": 0.16666666666666666,
        "color": "#abfa00",
        "alpha": 1
      },
      {
        "t": 0.3333333333333333,
        "color": "#def722",
        "alpha": 1
      },
      {
        "t": 0.5,
        "color": "#f9f22f",
        "alpha": 0.93
      },
      {
        "t": 0.6666666666666666,
        "color": "#ffab1a",
        "alpha": 0.76
      },
      {
        "t": 0.8333333333333334,
        "color": "#fd1212",
        "alpha": 0.48
      },
      {
        "t": 1,
        "color": "#cf0707",
        "alpha": 0
      }
    ]
  },
  "travel": {
    "walkSpeedKmh": 4.0,
    "navetteWaitFactor": 0,
    "terWaitFactor": 0,
    "tramWaitFactor": 0,
    "terWait": 15,
    "tramWait": 4,
    "bhnsWait": 0,
    "navetteWait": 5,
    "railMagnetRadiusKm": 1.7,
    "disabledBusNetworks": [],
    "busWaitFactor": 0,
    "busEntryPenalty": 0,
    "busExitPenalty": 0,
    "busTransferPenalty": 1,
    "busWalkingTransferPenalty": 1,
    "stationEntryPenalty": 0.5,
    "stationExitPenalty": 0.5,
    "transferPenalty": 3,
    "walkingTransferPenalty": 1.5
  },
  "map": {
    "originPoint": [
      54638.4,
      5274993.7
    ],
    "probePoint": [
      74521.7,
      5269617.4
    ],
    "viewportCenter": [
      51979.0134857003,
      5271087.110605713
    ],
    "viewportScale": 1.8952675337928702,
    "outlineMinutes": [
      30,
      60
    ],
    "maxTransitTime": 60,
    "includeProjects": true,
    "walkingOnRoads": false
  }
};
