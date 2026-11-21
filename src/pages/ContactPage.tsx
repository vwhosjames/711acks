import React, { useState } from 'react';
import { CheckCircle2, Send } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { REPORT_CATEGORIES, ReportCategory } from '../types/domain';
import { PublicRoute } from '../components/Navbar';

interface ContactPageProps {
  relatedSlug?: string;
  onNavigate: (route: PublicRoute) => void;
}

/**
 * Section 16 Requirements:
 * Form fields:
 * - Name — optional
 * - Email — optional
 * - Report category — required (5 approved categories)
 * - Message — required
 */
export const ContactPage: React.FC<ContactPageProps> = ({
  relatedSlug = '',
  onNavigate,
}) => {
  const { submitContactReport } = useApp();

  const [reporterName, setReporterName] = useState('');
  const [reporterEmail, setReporterEmail] = useState('');
  const [category, setCategory] = useState<ReportCategory>(
    relatedSlug
      ? 'Incorrect or Outdated Product Price'
      : 'Incorrect Recipe Information'
  );
  const [message, setMessage] = useState(
    relatedSlug
      ? `Regarding recipe "/drinks/${relatedSlug}": `
      : ''
  );
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setError('');

    if (reporterEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(reporterEmail.trim())) {
      setError('Please enter a valid email address or leave the optional email field blank.');
      return;
    }

    setIsSubmitting(true);
    const res = await submitContactReport({
      reporterName,
      reporterEmail,
      category,
      message,
      relatedRecipeSlug: relatedSlug || undefined,
    });
    setIsSubmitting(false);

    if (!res.success) {
      setError(res.error || 'Could not submit report.');
      return;
    }

    setSubmitted(true);
  };

  return (
    <div className="min-h-screen bg-[#F5F3EC] dark:bg-[#17201B] text-[#17201B] dark:text-[#F5F3EC] py-14 px-6">
      <div className="max-w-2xl mx-auto space-y-10">
        <div className="space-y-3 border-b border-[#C9C5B8]/50 dark:border-[#294735] pb-6">
          <p className="font-mono-tabular text-xs uppercase tracking-[0.24em] text-[#294735] dark:text-[#D7E07A]">
            COMMUNITY FEEDBACK &amp; PRICE VERIFICATION REPORTS
          </p>
          <h1 className="font-display text-3xl sm:text-5xl font-light uppercase tracking-[0.12em]">
            Contact &amp; Reports
          </h1>
          <p className="text-sm text-[#17201B]/75 dark:text-[#C9C5B8]">
            Report an outdated 7-Eleven Philippines product price, flag inaccurate recipe details, or send general feedback to the administrator. No account is required.
          </p>
        </div>

        {submitted ? (
          <div className="p-8 bg-[#FFFFFF] dark:bg-[#1E2B23] border border-[#C9C5B8] dark:border-[#294735] rounded-md text-center space-y-4">
            <CheckCircle2 className="w-10 h-10 text-[#294735] dark:text-[#D7E07A] mx-auto" />
            <h2 className="font-display text-2xl font-light uppercase tracking-wider">
              Report Logged for Admin Review
            </h2>
            <p className="text-sm text-[#17201B]/80 dark:text-[#C9C5B8]">
              Thank you for helping keep 711acks accurate. Your report has been saved and will appear in the administrator&apos;s Contact Reports queue.
            </p>
            <div className="pt-2 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => onNavigate({ page: 'explore' })}
                className="px-5 py-2.5 text-xs font-semibold uppercase tracking-wider bg-[#294735] text-[#F5F3EC] dark:bg-[#D7E07A] dark:text-[#17201B] rounded cursor-pointer"
              >
                Return to Explore
              </button>
              <button
                type="button"
                onClick={() => {
                  setSubmitted(false);
                  setMessage('');
                }}
                className="px-4 py-2.5 text-xs font-medium border border-[#C9C5B8] dark:border-[#294735] rounded cursor-pointer"
              >
                Send Another Report
              </button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="p-6 sm:p-8 bg-[#FFFFFF] dark:bg-[#1E2B23] border border-[#C9C5B8]/60 dark:border-[#294735] rounded-md space-y-6"
          >
            {error && (
              <div
                role="alert"
                className="p-3.5 bg-red-950/15 dark:bg-red-950/40 border border-red-600/50 text-red-700 dark:text-red-300 rounded text-xs font-medium"
              >
                {error}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label
                  htmlFor="contact-name"
                  className="block text-xs font-semibold uppercase tracking-wider"
                >
                  Name (Optional)
                </label>
                <input
                  id="contact-name"
                  type="text"
                  value={reporterName}
                  onChange={(e) => setReporterName(e.target.value)}
                  placeholder="Optional name or handle"
                  className="w-full px-3.5 py-2.5 text-sm bg-[#F5F3EC] dark:bg-[#17201B] border border-[#C9C5B8] dark:border-[#294735] rounded"
                />
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="contact-email"
                  className="block text-xs font-semibold uppercase tracking-wider"
                >
                  Email (Optional)
                </label>
                <input
                  id="contact-email"
                  type="email"
                  value={reporterEmail}
                  onChange={(e) => setReporterEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="w-full px-3.5 py-2.5 text-sm bg-[#F5F3EC] dark:bg-[#17201B] border border-[#C9C5B8] dark:border-[#294735] rounded"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label
                htmlFor="contact-category"
                className="block text-xs font-semibold uppercase tracking-wider"
              >
                Report Category *
              </label>
              <select
                id="contact-category"
                value={category}
                onChange={(e) => setCategory(e.target.value as ReportCategory)}
                className="w-full px-3.5 py-2.5 text-sm bg-[#F5F3EC] dark:bg-[#17201B] border border-[#C9C5B8] dark:border-[#294735] rounded"
              >
                {REPORT_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label
                htmlFor="contact-message"
                className="block text-xs font-semibold uppercase tracking-wider"
              >
                Message *
              </label>
              <textarea
                id="contact-message"
                rows={5}
                required
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Include the drink name, 7-Eleven product name, or updated store price..."
                className="w-full px-3.5 py-2.5 text-sm bg-[#F5F3EC] dark:bg-[#17201B] border border-[#C9C5B8] dark:border-[#294735] rounded"
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="px-6 py-3 text-xs font-semibold uppercase tracking-wider bg-[#294735] text-[#F5F3EC] dark:bg-[#D7E07A] dark:text-[#17201B] rounded flex items-center gap-2 cursor-pointer disabled:opacity-60"
            >
              <Send className="w-4 h-4" />
              <span>{isSubmitting ? 'Submitting Report...' : 'Submit Report'}</span>
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
