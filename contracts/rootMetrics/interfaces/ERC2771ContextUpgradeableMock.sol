abstract contract ERC2771ContextUpgradeableMock {
    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    address private immutable _trustedForwarder;
}
