import { StoreFooter } from '@/shared/components/store-layout/store-footer'
import { StoreHeader } from '@/shared/components/store-layout/store-header'
import { HeroSection } from './sections/hero-section'
import { HomeCatalog } from './sections/home-catalog'
import './home-v2.css'

export function HomeV2Page() {
  return (
    <div className="store-page hv2" id="top">
      <StoreHeader />
      <main>
        <div className="store-container">
          <HeroSection />
          <HomeCatalog />
        </div>
      </main>
      <StoreFooter />
    </div>
  )
}
