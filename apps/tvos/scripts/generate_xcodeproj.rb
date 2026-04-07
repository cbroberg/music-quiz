#!/usr/bin/env ruby
# Regenerates apps/tvos/MusicQuiz.xcodeproj from the source tree under
# apps/tvos/MusicQuiz/. Re-run this whenever new Swift files are added — the
# project file is intentionally treated as a build artifact so it can be
# rebuilt cleanly.
#
# Usage:  ruby apps/tvos/scripts/generate_xcodeproj.rb
require 'xcodeproj'
require 'fileutils'
require 'pathname'

ROOT          = Pathname.new(File.expand_path('..', __dir__))
PROJECT_PATH  = ROOT.join('MusicQuiz.xcodeproj')
APP_NAME      = 'MusicQuiz'
BUNDLE_ID     = 'dk.webhouse.music-quiz.tvos'
DEPLOY_TARGET = '17.0'
TEAM_ID       = '7NAG4UJCT9'

FileUtils.rm_rf(PROJECT_PATH)
project = Xcodeproj::Project.new(PROJECT_PATH, false, 56)
project.root_object.attributes['LastSwiftUpdateCheck']    = '1530'
project.root_object.attributes['LastUpgradeCheck']        = '1530'
project.root_object.attributes['ORGANIZATIONNAME']        = 'WebHouse'

# ── Project-level build settings ─────────────────────────────────────────
project.build_configurations.each do |bc|
  bc.build_settings.merge!(
    'ALWAYS_SEARCH_USER_PATHS'                => 'NO',
    'CLANG_ENABLE_MODULES'                    => 'YES',
    'CLANG_ENABLE_OBJC_ARC'                   => 'YES',
    'ENABLE_STRICT_OBJC_MSGSEND'              => 'YES',
    'GCC_C_LANGUAGE_STANDARD'                 => 'gnu17',
    'SDKROOT'                                 => 'appletvos',
    'SUPPORTED_PLATFORMS'                     => 'appletvos appletvsimulator',
    'TARGETED_DEVICE_FAMILY'                  => '3',
    'TVOS_DEPLOYMENT_TARGET'                  => DEPLOY_TARGET,
    'SWIFT_VERSION'                           => '5.0',
    'IPHONEOS_DEPLOYMENT_TARGET'              => DEPLOY_TARGET
  )
  if bc.name == 'Debug'
    bc.build_settings.merge!(
      'SWIFT_OPTIMIZATION_LEVEL'                  => '-Onone',
      'SWIFT_ACTIVE_COMPILATION_CONDITIONS'       => 'DEBUG',
      'GCC_PREPROCESSOR_DEFINITIONS'              => ['DEBUG=1', '$(inherited)'],
      'ONLY_ACTIVE_ARCH'                          => 'YES',
      'DEBUG_INFORMATION_FORMAT'                  => 'dwarf'
    )
  else
    bc.build_settings.merge!(
      'SWIFT_OPTIMIZATION_LEVEL'                  => '-O',
      'SWIFT_COMPILATION_MODE'                    => 'wholemodule',
      'DEBUG_INFORMATION_FORMAT'                  => 'dwarf-with-dsym'
    )
  end
end

# ── App target ───────────────────────────────────────────────────────────
target = project.new_target(:application, APP_NAME, :tvos, DEPLOY_TARGET, nil, :swift)

target.build_configurations.each do |bc|
  bc.build_settings.merge!(
    'PRODUCT_NAME'                                  => '$(TARGET_NAME)',
    'PRODUCT_BUNDLE_IDENTIFIER'                     => BUNDLE_ID,
    'INFOPLIST_FILE'                                => 'MusicQuiz/Config/Info.plist',
    'CODE_SIGN_ENTITLEMENTS'                        => 'MusicQuiz/Config/MusicQuiz.entitlements',
    'DEVELOPMENT_TEAM'                              => TEAM_ID,
    'TVOS_DEPLOYMENT_TARGET'                        => DEPLOY_TARGET,
    'SWIFT_VERSION'                                 => '5.0',
    'TARGETED_DEVICE_FAMILY'                        => '3',
    'SDKROOT'                                       => 'appletvos',
    'SUPPORTED_PLATFORMS'                           => 'appletvos appletvsimulator',
    'ASSETCATALOG_COMPILER_APPICON_NAME'            => 'AppIcon',
    'ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME'=> '',
    # Apple Generic Versioning — required by fastlane increment_build_number
    'VERSIONING_SYSTEM'                             => 'apple-generic',
    'CURRENT_PROJECT_VERSION'                       => '1',
    'MARKETING_VERSION'                             => '0.1.0',
    'LD_RUNPATH_SEARCH_PATHS'                       => ['$(inherited)', '@executable_path/Frameworks'],
    'ENABLE_PREVIEWS'                               => 'YES',
    'GENERATE_INFOPLIST_FILE'                       => 'NO'
  )
  if bc.name == 'Debug'
    # Debug builds run in Simulator — no signing needed.
    bc.build_settings['CODE_SIGN_STYLE']       = 'Automatic'
    bc.build_settings['CODE_SIGNING_ALLOWED']  = 'NO'
    bc.build_settings['CODE_SIGNING_REQUIRED'] = 'NO'
  else
    # Release builds (fastlane archive) use MANUAL signing with the App Store
    # provisioning profile created by `sigh` in the Fastfile beta lane.
    bc.build_settings['CODE_SIGN_STYLE']                = 'Manual'
    bc.build_settings['CODE_SIGN_IDENTITY']             = 'Apple Distribution'
    bc.build_settings['PROVISIONING_PROFILE_SPECIFIER'] = "#{BUNDLE_ID} AppStore"
  end
end

# ── Source groups ────────────────────────────────────────────────────────
main_group = project.main_group.new_group(APP_NAME, APP_NAME)

def add_swift_files(group, dir, target)
  Pathname.glob(dir.join('**/*.swift')).sort.each do |path|
    rel        = path.relative_path_from(dir.parent)
    sub_group  = group
    rel.dirname.each_filename do |segment|
      next if segment == '.'
      existing = sub_group.children.find { |c| c.is_a?(Xcodeproj::Project::Object::PBXGroup) && c.display_name == segment }
      sub_group = existing || sub_group.new_group(segment, segment)
    end
    file_ref = sub_group.new_reference(path.to_s)
    target.add_file_references([file_ref])
  end
end

add_swift_files(main_group, ROOT.join(APP_NAME), target)

# ── TargetAttributes (ProvisioningStyle) ─────────────────
# Required for Xcode's automatic signing to correctly pick an Apple Distribution
# profile during archive (instead of trying to create an Apple Development profile,
# which would require a registered device on the team).
project.root_object.attributes['TargetAttributes'] = {
  target.uuid => {
    'CreatedOnToolsVersion' => '15.0',
    'ProvisioningStyle' => 'Manual',
    'DevelopmentTeam' => TEAM_ID,
  },
}

# Resources: Info.plist is referenced via INFOPLIST_FILE (not added to phase),
# entitlements via CODE_SIGN_ENTITLEMENTS. Asset catalog must be in resources.
assets_path = ROOT.join(APP_NAME, 'Assets.xcassets')
if assets_path.exist?
  assets_ref = main_group.new_reference(assets_path.to_s)
  target.add_resources([assets_ref])
end

project.save
puts "✅ Generated #{PROJECT_PATH.relative_path_from(ROOT.parent.parent)}"
