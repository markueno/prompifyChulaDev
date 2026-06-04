export default function Footer() {
  return (
    <section className="info">
      <div className="info-top">
        <p>© 2024 Basic Concept Limited. All rights reserved.</p>
      </div>
      <div className="info-bottom">
        <div className="info-col">
          <h4>Company</h4>
          <a href="#about">About Us</a>
          <a href="#careers">Careers</a>
          <a href="#blog">Blog</a>
        </div>
        <div className="info-col">
          <h4>Product</h4>
          <a href="#features">Features</a>
          <a href="#pricing">Pricing</a>
          <a href="#docs">Documentation</a>
        </div>
        <div className="info-col">
          <h4>Support</h4>
          <a href="#help">Help Center</a>
          <a href="#contact">Contact Us</a>
          <a href="#faq">FAQ</a>
        </div>
        <div className="info-col">
          <h4>Legal</h4>
          <a href="#privacy">Privacy Policy</a>
          <a href="#terms">Terms of Service</a>
          <a href="#cookies">Cookie Policy</a>
        </div>
      </div>
    </section>
  )
}
