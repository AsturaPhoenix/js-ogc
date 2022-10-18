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

/// <reference types="@types/google.maps" />

/**
 * @ignore
 */
const DEFAULT_WMS_PARAMS = {
  request: "GetMap",
  service: "WMS",
  srs: "EPSG:3857",
};

/**
 * @ignore
 */
const EPSG_3857_EXTENT = 20037508.34789244;

/**
 * @ignore
 */
const ORIG_X = -EPSG_3857_EXTENT; // x starts from right

/**
 * @ignore
 */
const ORIG_Y = EPSG_3857_EXTENT; // y starts from top

/**
 * Convert xyz tile coordinates to mercator bounds.
 *
 * @param x
 * @param y
 * @param zoom
 * @returns {number[]} minx, miny, maxx, maxy
 */
function xyzToBounds(x: number, y: number, zoom: number, tileSize: number): number[] {
  const wmsTileSize = EPSG_3857_EXTENT * tileSize / (1 << zoom + 7);
  const minx = ORIG_X + x * wmsTileSize;
  const maxx = ORIG_X + (x + 1) * wmsTileSize;
  const miny = ORIG_Y - (y + 1) * wmsTileSize;
  const maxy = ORIG_Y - y * wmsTileSize;
  return [minx, miny, maxx, maxy];
}

interface WmsMapTypeOptions {
  url: string;
  layers: string;
  maxZoom: number;
  styles?: string;
  bgcolor?: string;
  version?: string;
  transparent?: boolean;
  format?: string;
  outline?: boolean;
  levelOfDetail?: number; // desired minZoom only for tile data
  maxOversample?: number; // max difference between zoom and LOD
  name?: string;
  alt?: string;
  minZoom?: number;
  opacity?: number;
  tileSize?: number;
}

interface TileData {
  coord: google.maps.Point;
  zoom: number;
}

/**
 *
 * @param {WmsMapTypeOptions} params
 */
class WmsMapType implements google.maps.MapType {
  alt: string|null;
  maxZoom: number;
  minZoom: number;
  name: string|null;
  opacity: number|null;
  _tileSize: number;
  get tileSize(): google.maps.Size {
    return new google.maps.Size(this._tileSize, this._tileSize);
  }
  projection: null;
  radius: null;

  _url: string;
  get url() {
    return this._url;
  }
  set url(value) {
    if (value.slice(-1) !== "?") {
      value += "?";
    }
    this._url = value;
  }
  levelOfDetail: number;
  maxOversample: number;

  private readonly params: object;
  private readonly tiles = new Map<HTMLImageElement, TileData>();

  constructor({
    url,
    layers,
    styles = "",
    bgcolor = "0xFFFFFF",
    version = "1.1.1",
    transparent = true,
    format = "image/png",
    outline = false,
    levelOfDetail = 0,
    maxOversample = 2,
    // google.maps.ImageMapTypeOptions interface
    name,
    alt,
    maxZoom,
    minZoom,
    opacity,
    tileSize = 256,
  }: WmsMapTypeOptions) {
    this.params = {
      layers,
      styles,
      version,
      transparent: String(transparent),
      bgcolor,
      format,
      outline: String(outline),
      ...DEFAULT_WMS_PARAMS,
    };

    this.name = name;
    this.alt = alt;
    this.opacity = opacity;
    this.maxZoom = maxZoom;
    this.minZoom = minZoom;
    this._tileSize = tileSize;
    
    this.url = url;
    this.levelOfDetail = levelOfDetail;
    this.maxOversample = maxOversample;
  }

  getTileUrl(coord: google.maps.Point, zoom: number): string {
    // To cap the min LOD, we only need to adjust the tile size parameter passed to the tile server.
    // The zoom and tile size adjustments cancel out for xyzToBounds.
    const tileSizeParam = String(zoom >= this.levelOfDetail? this._tileSize :
      (this._tileSize << Math.min(this.levelOfDetail - zoom, this.maxOversample)));

    return (
      this.url +
      new URLSearchParams({
        bbox: xyzToBounds(coord.x, coord.y, zoom, this._tileSize).join(","),
        ...this.params,
        width: tileSizeParam,
        height: tileSizeParam,
      }).toString()
    );
  }

  getTile(coord: google.maps.Point, zoom: number, ownerDocument: Document): Element {
      const img = ownerDocument.createElement("img");
      img.src = this.getTileUrl(coord, zoom);
      img.height = this._tileSize;
      img.width = this._tileSize;
      this.tiles.set(img, {coord, zoom});
      return img;
  }

  releaseTile(tile: HTMLImageElement): void {
    this.tiles.delete(tile);
  }

  refreshTiles(): void {
    for (const [img, data] of this.tiles) {
      img.src = this.getTileUrl(data.coord, data.zoom);
    }
  }
}

export {
  EPSG_3857_EXTENT,
  DEFAULT_WMS_PARAMS,
  xyzToBounds,
  WmsMapType,
  WmsMapTypeOptions,
};
