import { useCallback, useRef, useState, useLayoutEffect } from "react";

import {
  Align,
  Item,
  IsItemLoaded,
  ItemSize,
  KeyGenerator,
  LoadMore,
  Measure,
  OnScroll,
  Options,
  Return,
  ScrollEasingFunction,
  ScrollTo,
  ScrollToOptions,
  ScrollToItem,
  ScrollToItemOptions,
} from "./types";
import {
  easeInOutCubic,
  findNearestBinarySearch,
  invariant,
  isNumber,
  isShallowEqual,
  now,
  useAnimDebounce,
  // useIsoLayoutEffect,
  useLatest,
  useResizeEffect,
} from "./utils";

const DEFAULT_ITEM_SIZE = 50;

const useVirtual = <
  O extends HTMLElement = HTMLElement,
  I extends HTMLElement = HTMLElement
>({
  itemCount,
  itemSize = DEFAULT_ITEM_SIZE,
  horizontal,
  overscanCount = 1,
  useIsScrolling,
  scrollDuration = 500,
  scrollEasingFunction = easeInOutCubic,
  keyGenerator,
  onScroll,
  loadMoreThreshold = 15,
  isItemLoaded,
  loadMore,
}: Options): Return<O, I> => {
  const [items, setItems] = useState<Item[]>([]);
  const shouldLoadMoreOnMountRef = useRef(true);
  const offsetRef = useRef(0);
  const outerRef = useRef<O>(null);
  const innerRef = useRef<I>(null);
  const outerSizeRef = useRef(0);
  const measuresRef = useRef<Measure[]>([]);
  const userScrollRef = useRef(true);
  const scrollRafRef = useRef<number>();
  const easingFnRef = useLatest<ScrollEasingFunction>(scrollEasingFunction);
  const keyGeneratorRef = useLatest<KeyGenerator | undefined>(keyGenerator);
  const itemSizeRef = useLatest<ItemSize>(itemSize);
  const onScrollRef = useLatest<OnScroll | undefined>(onScroll);
  const isItemLoadedRef = useRef<IsItemLoaded | undefined>(isItemLoaded);
  const loadMoreRef = useLatest<LoadMore | undefined>(loadMore);
  const sizeKey = !horizontal ? "height" : "width";
  const observerSizeKey = !horizontal ? "blockSize" : "inlineSize";
  const marginKey = !horizontal ? "marginTop" : "marginLeft";
  const scrollKey = !horizontal ? "scrollTop" : "scrollLeft";

  const getItemSize = useCallback(
    (idx: number) => {
      if (measuresRef.current[idx]) return measuresRef.current[idx].size;

      let { current: size } = itemSizeRef;
      size = isNumber(size) ? size : size(idx);

      return size ?? DEFAULT_ITEM_SIZE;
    },
    [itemSizeRef]
  );

  const getMeasures = useCallback(() => {
    const measures: Measure[] = [];

    for (let i = 0; i < itemCount; i += 1) {
      const start = i ? measures[i - 1].end : 0;
      const size = getItemSize(i);
      const measure: Measure = { idx: i, start, end: start + size, size };

      if (keyGeneratorRef.current) measure.key = keyGeneratorRef.current();

      measures.push(measure);
    }

    return measures;
  }, [getItemSize, itemCount, keyGeneratorRef]);

  const getCalcData = useCallback(
    (offset: number) => {
      const { current: measures } = measuresRef;
      const startIdx = findNearestBinarySearch(
        0,
        measures.length,
        offset,
        measuresRef.current.map(({ start }) => start)
      );
      let endIdx = startIdx;

      while (
        endIdx < measures.length &&
        measures[endIdx].start < offset + outerSizeRef.current
      )
        endIdx += 1;

      const start = Math.max(startIdx - overscanCount, 0);
      const margin = measures[start].start;

      return {
        startIdx,
        endIdx: endIdx - 1,
        start,
        end: Math.min(endIdx + overscanCount, measures.length) - 1,
        margin,
        innerSize: measures[measures.length - 1].end - margin,
      };
    },
    [overscanCount]
  );

  const [resetIsScrolling, cancelResetIsScrolling] = useAnimDebounce(
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    () => updateItems(offsetRef.current),
    200
  );

  const [resetUserScroll, cancelResetUserScroll] = useAnimDebounce(
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    () => {
      userScrollRef.current = true;
    },
    200
  );

  const updateItems = useCallback(
    (offset: number, isScrolling = false) => {
      if (
        shouldLoadMoreOnMountRef.current &&
        loadMoreRef.current &&
        !(isItemLoadedRef.current && isItemLoadedRef.current(0))
      )
        loadMoreRef.current({
          startIndex: 0,
          stopIndex: loadMoreThreshold - 1,
          batchIndex: 0,
          scrollOffset: 0,
        });

      shouldLoadMoreOnMountRef.current = false;

      if (!itemCount) return;

      const { startIdx, endIdx, start, end, margin, innerSize } =
        getCalcData(offset);

      innerRef.current!.style[marginKey] = `${margin}px`;
      innerRef.current!.style[sizeKey] = `${innerSize}px`;

      const nextItems: Item[] = [];
      let shouldRecalc = false;

      for (let i = start; i <= end; i += 1)
        nextItems.push({
          key: measuresRef.current[i].key,
          index: i,
          size: measuresRef.current[i].size,
          outerSize: outerSizeRef.current,
          isScrolling: useIsScrolling ? isScrolling : undefined,
          // eslint-disable-next-line no-loop-func
          measureRef: (el) => {
            if (!el) return;

            // eslint-disable-next-line compat/compat
            let observer: ResizeObserver | undefined = new ResizeObserver(
              ([{ borderBoxSize }]) => {
                const { [observerSizeKey]: size } = borderBoxSize[0];

                if (size !== measuresRef.current[i].size) {
                  measuresRef.current[i].size = size;
                  shouldRecalc = true;
                }

                if (i === end && shouldRecalc) {
                  measuresRef.current = getMeasures();
                  updateItems(offset, isScrolling);
                }

                observer?.disconnect();
                observer = undefined;
              }
            );

            observer.observe(el);
          },
        });

      let shouldUpdate = true;

      setItems((prevItems) => {
        shouldUpdate = !isShallowEqual(prevItems, nextItems);
        return shouldUpdate ? nextItems : prevItems;
      });

      const scrollForward = offset > offsetRef.current;

      if (isScrolling) {
        const batchIndex = Math.floor(endIdx / loadMoreThreshold);
        const startIndex = batchIndex * loadMoreThreshold;

        if (
          shouldUpdate &&
          loadMoreRef.current &&
          !(isItemLoadedRef.current && isItemLoadedRef.current(batchIndex))
        )
          loadMoreRef.current({
            startIndex,
            stopIndex: startIndex + loadMoreThreshold - 1,
            batchIndex,
            scrollOffset: offset,
          });

        if (onScrollRef.current)
          onScrollRef.current({
            overscanStartIndex: start,
            overscanStopIndex: end,
            itemStartIndex: startIdx,
            itemStopIndex: endIdx,
            scrollOffset: offset,
            scrollForward,
            userScroll: userScrollRef.current,
          });

        if (useIsScrolling) resetIsScrolling();
        if (!userScrollRef.current) resetUserScroll();
      }

      offsetRef.current = offset;
    },
    [
      getCalcData,
      getMeasures,
      itemCount,
      loadMoreRef,
      loadMoreThreshold,
      marginKey,
      observerSizeKey,
      onScrollRef,
      resetIsScrolling,
      resetUserScroll,
      sizeKey,
      useIsScrolling,
    ]
  );

  const scrollTo = useCallback<ScrollTo>(
    (value, cb) => {
      const { offset, smooth }: ScrollToOptions = isNumber(value)
        ? { offset: value }
        : value;
      const prevOffset = offsetRef.current;

      if (!isNumber(offset) || offset === prevOffset) return;

      userScrollRef.current = false;

      if (!smooth) {
        outerRef.current![scrollKey] = offset;
        if (cb) cb();
        return;
      }

      const start = now();

      const scroll = () => {
        const time = Math.min((now() - start) / scrollDuration, 1);

        outerRef.current![scrollKey] =
          easingFnRef.current(time) * (offset - prevOffset) + prevOffset;

        if (time < 1) {
          scrollRafRef.current = requestAnimationFrame(scroll);
        } else if (cb) {
          cb();
        }
      };

      scrollRafRef.current = requestAnimationFrame(scroll);
    },
    [easingFnRef, scrollDuration, scrollKey]
  );

  const scrollToItem = useCallback<ScrollToItem>(
    (value, cb) => {
      const {
        index,
        align = Align.auto,
        smooth,
        autoCorrect,
      }: ScrollToItemOptions = isNumber(value) ? { index: value } : value;

      if (!isNumber(index)) return;

      const measure =
        measuresRef.current[Math.max(0, Math.min(index, itemCount - 1))];

      if (!measure) return;

      const { start, end, size } = measure;
      const { current: outerSize } = outerSizeRef;
      let offset = offsetRef.current;

      if (autoCorrect && offset <= start && offset + outerSize >= end && cb) {
        cb();
        return;
      }

      const endPos = start - outerSize + size;

      switch (align) {
        case Align.start:
          offset = start;
          break;
        case Align.center:
          offset = start - outerSize / 2 + size / 2;
          break;
        case Align.end:
          offset = endPos;
          break;
        default:
          if (offset >= start) {
            offset = start;
          } else if (offset + outerSize <= end) {
            offset = endPos;
          }
      }

      scrollTo({ offset, smooth }, () => {
        if (!autoCorrect) {
          if (cb) cb();
        } else if (offset >= start || offset + outerSize <= end) {
          requestAnimationFrame(() => scrollToItem(value, cb));
        }
      });
    },
    [itemCount, scrollTo]
  );

  useResizeEffect<O>(
    outerRef,
    (rect) => {
      invariant(!isNumber(itemCount), "Item count error");

      outerSizeRef.current = rect[sizeKey];
      measuresRef.current = getMeasures();
      updateItems(offsetRef.current);
    },
    [itemCount, getMeasures, updateItems]
  );

  useLayoutEffect(() => {
    const { current: outer } = outerRef;

    invariant(!outer, "Outer error");
    invariant(!innerRef.current, "Inner error");

    const handleScroll = ({ target }: Event) =>
      updateItems((target as O)[scrollKey], true);

    outer!.addEventListener("scroll", handleScroll);

    return () => {
      cancelResetIsScrolling();
      cancelResetUserScroll();
      if (scrollRafRef.current) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = undefined;
      }

      outer!.removeEventListener("scroll", handleScroll);
    };
  }, [cancelResetIsScrolling, cancelResetUserScroll, scrollKey, updateItems]);

  return { outerRef, innerRef, items, scrollTo, scrollToItem };
};

export default useVirtual;
