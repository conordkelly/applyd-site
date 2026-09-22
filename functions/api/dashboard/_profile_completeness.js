// Shared profile completeness checks for My Info → job submit gate.
// Keep labels human-readable — they surface in the dashboard submit note.

function filled(v) {
  return String(v == null ? "" : v).trim() !== "";
}

function hasUsableExperience(roles) {
  if (!Array.isArray(roles) || !roles.length) return false;
  return roles.some(function (role) {
    return filled(role && role.company) && filled(role && role.role);
  });
}

function hasSalary(profile) {
  if (!profile || typeof profile !== "object") return false;
  if (filled(profile.salary_display)) return true;
  if (filled(profile.salary_expectation)) return true;
  if (filled(profile.salary_min) || filled(profile.salary_max)) return true;
  var c = profile.canonical && profile.canonical.professional_background;
  if (c && filled(c.general_salary_expectation)) return true;
  return false;
}

function hasResume(profile) {
  if (!profile || typeof profile !== "object") return false;
  if (filled(profile.resume_upload_filename) || filled(profile.resume_url)) {
    return true;
  }
  var assets = profile.canonical && profile.canonical.assets;
  return !!(assets && (filled(assets.resume_upload_filename) || filled(assets.resume_url)));
}

/** @returns {string[]} human-readable gap labels (empty = complete) */
export function profileCompletenessGaps(profile) {
  profile = profile && typeof profile === "object" ? profile : {};
  var gaps = [];

  function need(label, value) {
    if (!filled(value)) gaps.push(label);
  }

  need("First name", profile.first_name);
  need("Last name", profile.last_name);
  need("Phone", profile.phone);
  need("Phone country", profile.phone_country_display);
  need("Country", profile.country);
  need("Street address", profile.address);
  need("City", profile.city);
  need("State / province", profile.province_full);
  need("Postal / ZIP code", profile.postal_code);
  need("Work authorization", profile.legally_authorized);
  need("Visa sponsorship", profile.require_sponsorship);
  need("Preferred job location", profile.preferred_job_location);
  need("School / university", profile.school);

  if (!hasSalary(profile)) gaps.push("Desired salary");
  if (!hasResume(profile)) gaps.push("Resume PDF");
  if (!hasUsableExperience(profile.experience_roles)) {
    gaps.push("At least one work experience role (company + title)");
  }

  return gaps;
}

export function isProfileComplete(profile) {
  return profileCompletenessGaps(profile).length === 0;
}
