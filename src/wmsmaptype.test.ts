/**
 * Copyright 2019 Google LLC. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/// <reference types="@types/jest" />
/// <reference types="@types/google.maps" />

import { initialize } from "@googlemaps/jest-mocks";
import {
  xyzToBounds,
  EPSG_3857_EXTENT,
  WmsMapType,
  WmsMapTypeOptions,
  DEFAULT_WMS_PARAMS,
} from "./wmsmaptype";

beforeEach(() => {
  initialize();
});

test("xyzToBounds is correct", () => {
  expect(xyzToBounds(0, 0, 0, 256)).toEqual([
    -EPSG_3857_EXTENT,
    -EPSG_3857_EXTENT,
    EPSG_3857_EXTENT,
    EPSG_3857_EXTENT,
  ]);
});

test.each([
  [
    {
      url: "https://www.mrlc.gov/geoserver/NLCD_Land_Cover/wms",
      layers: "mrlc_display:NLCD_2016_Land_Cover_L48",
      styles: "mrlc:mrlc_NLCD_2016_Land_Cover_L48_20190424",
      bgcolor: "0xFFFFFF",
      version: "1.2.3",
      format: "image/jpeg",
      outline: true,
      transparent: true,
      name: "Land Cover",
      alt: "NLCD_2016_Land_Cover_L48",
      maxZoom: 18,
      minZoom: 0,
      opacity: 1.0,
    },
  ],
  [
    {
      url: "https://www.mrlc.gov/geoserver/NLCD_Land_Cover/wms?",
      layers: "mrlc_display:NLCD_2016_Land_Cover_L48",
      maxZoom: 18,
    },
  ],
])("WmsMapType can be called with getTileUrl", (options: WmsMapTypeOptions) => {
  const wmsMapType = new WmsMapType(options);
  const tileUrl = wmsMapType.getTileUrl(new google.maps.Point(0, 0), 1, 0);
  const [base, queryString] = tileUrl.split("?");

  expect(base).toEqual("https://www.mrlc.gov/geoserver/NLCD_Land_Cover/wms");

  const params = new URLSearchParams(queryString);

  expect(params.get("layers")).toEqual(options["layers"]);
  expect(params.get("bgcolor")).toEqual(options["bgcolor"] || "0xFFFFFF");
  expect(params.get("styles")).toEqual(options["styles"] || "");
  expect(params.get("request")).toEqual(DEFAULT_WMS_PARAMS.request);
  expect(params.get("service")).toEqual(DEFAULT_WMS_PARAMS.service);
  expect(params.get("srs")).toEqual(DEFAULT_WMS_PARAMS.srs);
  expect(params.get("format")).toEqual(options["format"] || "image/png");
  expect(params.get("outline")).toEqual(String(options["outline"] || false));
  expect(params.get("version")).toEqual(options["version"] || "1.1.1");
  expect(params.get("height")).toEqual("256");
  expect(params.get("width")).toEqual("256");
});
