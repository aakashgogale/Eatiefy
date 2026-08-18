import { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AppShellSkeleton } from "@food/components/ui/loading-skeletons";
import {
  categoryBrowseNeedsRestore,
  runCategoryScrollLock,
} from "@food/utils/browseScrollMemory";

const CategoryPage = lazy(() => import("@food/pages/user/CategoryPage"));

/**
 * Keeps CategoryPage mounted under restaurant details.
 * Scroll restore runs ONLY when becoming visible again (restaurant → back),
 * never on sticky category chip switches — that fight steals taps app-wide.
 */
export default function CategoryBrowseKeepAlive({
  categorySlug,
  isVisible,
}) {
  const [mountedSlug, setMountedSlug] = useState(categorySlug || null);
  const wasVisibleRef = useRef(false);

  useEffect(() => {
    if (categorySlug) setMountedSlug(categorySlug);
  }, [categorySlug]);

  useLayoutEffect(() => {
    const becameVisible = isVisible && !wasVisibleRef.current;
    wasVisibleRef.current = isVisible;

    if (!isVisible) return undefined;

    // Chip / URL slug change while already browsing — leave scroll alone.
    if (!becameVisible) return undefined;

    if (!categoryBrowseNeedsRestore()) return undefined;

    return runCategoryScrollLock({ durationMs: 100 });
  }, [isVisible, categorySlug]);

  if (!mountedSlug) return null;

  return (
    <div
      style={{ display: isVisible ? "block" : "none" }}
      aria-hidden={!isVisible}
      data-category-browse-preserved={!isVisible ? "true" : undefined}
    >
      <Suspense fallback={isVisible ? <AppShellSkeleton /> : null}>
        <CategoryPage
          embeddedCategorySlug={mountedSlug}
          isBrowseActive={isVisible}
          disableAutoScroll
        />
      </Suspense>
    </div>
  );
}
