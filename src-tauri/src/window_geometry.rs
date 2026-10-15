//! Initial placement uses physical pixels throughout; DPI only scales the minimum.
use tauri::{PhysicalPosition, PhysicalSize, WebviewWindow};

#[derive(Debug, PartialEq)]
struct Geometry {
    size: PhysicalSize<u32>,
    minimum: PhysicalSize<u32>,
    position: PhysicalPosition<i32>,
}

fn calculate(screen: (u32, u32), work: (i32, i32, u32, u32), scale: f64) -> Option<Geometry> {
    let (x, y, width, height) = work;
    if screen.0 == 0 || screen.1 == 0 || width == 0 || height == 0 || !scale.is_finite() || scale <= 0.0 {
        return None;
    }
    let minimum = PhysicalSize::new((720.0 * scale).ceil().min(width as f64) as u32,
                                    (520.0 * scale).ceil().min(height as f64) as u32);
    let size = PhysicalSize::new(((screen.0 as f64 * 0.78).round() as u32).clamp(minimum.width, width),
                                 ((screen.1 as f64 * 0.88).round() as u32).clamp(minimum.height, height));
    Some(Geometry { size, minimum, position: PhysicalPosition::new(
        x.saturating_add(((width - size.width) / 2) as i32),
        y.saturating_add(((height - size.height) / 2) as i32)) })
}

/// Called once while hidden. Tray restoration never reapplies initial placement.
pub(crate) fn place(window: &WebviewWindow) -> tauri::Result<()> {
    if let Some(monitor) = window.primary_monitor()? {
        let area = monitor.work_area();
        if let Some(g) = calculate((monitor.size().width, monitor.size().height),
            (area.position.x, area.position.y, area.size.width, area.size.height), monitor.scale_factor()) {
            window.set_min_size(Some(g.minimum))?;
            window.set_size(g.size)?;
            window.set_position(g.position)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn screen_ratios_and_dpi() {
        for (screen, work, dpi, expected) in [
            ((1920,1080),(0,0,1920,1040),1.0,(1498,950)),
            ((1536,864),(0,0,1536,824),1.25,(1198,760)),
            ((2560,1440),(0,0,2560,1400),1.0,(1997,1267)),
            ((1280,720),(0,0,1280,680),1.0,(998,634)),
            ((3840,2160),(0,0,3840,2080),2.0,(2995,1901)),
        ] {
            let g = calculate(screen,work,dpi).unwrap();
            assert_eq!((g.size.width,g.size.height),expected);
            assert_eq!(g.position.x,(work.2-g.size.width) as i32/2);
            assert_eq!(g.position.y,(work.3-g.size.height) as i32/2);
            assert!(g.size.width as f64/dpi >= 720.0);
            assert!(g.size.height as f64/dpi >= 520.0);
        }
    }
    #[test]
    fn small_work_area_and_negative_origin() {
        let g = calculate((800,600),(-800,30,600,400),2.0).unwrap();
        assert_eq!(g.size,PhysicalSize::new(600,400));
        assert_eq!(g.minimum,g.size);
        assert_eq!(g.position,PhysicalPosition::new(-800,30));
        let g = calculate((1920,1080),(-1920,-1080,1920,1040),1.0).unwrap();
        assert_eq!(g.position,PhysicalPosition::new(-1709,-1035));
    }
    #[test]
    fn unusable_monitor_preserves_fallback() {
        for scale in [0.0,-1.0,f64::NAN,f64::INFINITY] {
            assert!(calculate((1920,1080),(0,0,1920,1040),scale).is_none());
        }
        assert!(calculate((0,0),(0,0,1920,1040),1.0).is_none());
        assert!(calculate((1920,1080),(0,0,0,0),1.0).is_none());
    }
}
